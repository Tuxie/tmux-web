# tmux-web Stdio Agent Remote Transport Design

## Goal

Add a first-class remote-host transport where local tmux-web serves the browser UI and connects to a remote host by starting one SSH stdio process:

```text
ssh -T <host-alias> tmux-web --stdio-agent
```

The remote agent multiplexes many tmux-web terminal channels over that single stdin/stdout stream. This gives one SSH authentication and one YubiKey touch per remote host connection while still supporting multiple browser tabs and tmux sessions.

Direct multi-SSH support using raw `tmux attach` plus raw `tmux -C` is explicitly out of scope for this first implementation.

## User Surface

The first version uses URL routing and OpenSSH config aliases. There is no session manager UI yet.

```text
/r/<host>/<session>
```

Examples:

```text
/r/prod/main
/r/laptop/dev
```

`<host>` is passed to `ssh` as a host alias. tmux-web does not store SSH credentials, private keys, passphrases, or YubiKey state. OpenSSH remains responsible for `ProxyJump`, `ControlMaster`, `known_hosts`, agent policy, and hardware-key prompts.

The local server should reject host strings that are not conservative SSH aliases. The first implementation should allow only letters, digits, dot, underscore, dash, and slash-free names. The session portion should use the existing tmux session sanitizer.

## Architecture

The browser-facing protocol stays unchanged: each browser WebSocket receives terminal bytes plus existing `TT` messages.

The server-side terminal source becomes abstracted:

```text
Browser WS
  -> local tmux-web WebSocket handler
    -> TerminalTransport
      -> LocalTmuxTransport, existing local behavior
      -> RemoteAgentTransport, new SSH stdio behavior
```

For remote URLs, `RemoteAgentManager` owns one SSH child process per remote host alias. Each browser WebSocket opens one logical channel on that agent.

```text
RemoteAgentManager("prod")
  ssh -T prod tmux-web --stdio-agent
  channel 1: browser tab A -> tmux session main -> remote PTY client
  channel 2: browser tab B -> tmux session dev  -> remote PTY client
  channel 3: browser tab C -> tmux session main -> separate remote PTY client
```

Each channel gets its own remote PTY client. Tabs viewing the same tmux session do not share a PTY client, because tmux client size, visible area, active pane state, and input ownership are client-specific.

The remote agent owns a remote `TmuxControl` pool. Control clients are attached per actively tracked tmux session and ref-counted across logical channels.

## Stdio Protocol

The SSH stdin/stdout stream uses binary length-prefixed frames. It must not use sentinel text framing and must not reuse `\x00TT:` as the outer protocol.

Frame envelope:

```text
uint32_be length
payload bytes
```

Payload format for the first implementation should be JSON for control frames and base64 for byte payloads unless binary payload performance becomes a real bottleneck. This keeps the protocol easy to inspect in tests. The envelope still prevents PTY bytes from corrupting protocol boundaries.

Every frame has:

```json
{
  "v": 1,
  "type": "frame-type",
  "channelId": "optional-channel-id"
}
```

Host-level frames:

- `hello`: local starts protocol negotiation.
- `hello-ok`: remote returns agent version and supported protocol version.
- `host-error`: remote reports an error not scoped to one channel.
- `shutdown`: either side requests graceful agent shutdown.

Channel-level frames:

- `open`: local asks remote to start a PTY client for `{ channelId, session, cols, rows }`.
- `open-ok`: remote confirms the channel is attached.
- `pty-in`: local sends terminal input bytes.
- `pty-out`: remote sends terminal output bytes.
- `resize`: local sends terminal size.
- `client-msg`: local forwards existing browser JSON actions such as session switch, clipboard decision, scrollbar action, or clipboard read reply.
- `server-msg`: remote forwards existing server messages that local should frame to the browser as `TT`.
- `close`: either side closes one logical channel.
- `channel-error`: remote reports a channel-scoped failure.

The protocol is ordered per SSH stream. The implementation should not assume that channel traffic is sequential by channel; frames from different channels may interleave.

## Remote Agent Behavior

`tmux-web --stdio-agent` does not start HTTP, TLS, auth, desktop, or static asset serving.

For each `open` frame, the remote agent:

1. Sanitizes the requested tmux session name.
2. Spawns a PTY using the existing tmux PTY command path.
3. Registers PTY data and exit callbacks.
4. Attaches or ref-counts remote control state for that session.
5. Sends initial window, title, and scrollbar state using existing server-side helpers where practical.

For `pty-in`, the agent writes to the channel PTY. For `resize`, it resizes only that channel PTY and mirrors the size hint to the session control client where today’s local path does so.

For `client-msg`, the agent must reuse the same routing semantics as the current WebSocket handler for all message types accepted by `ws-router.ts` at implementation time. Unsupported future message types must fail clearly rather than silently no-op.

For `close`, the agent kills the channel PTY, tears down per-channel subscriptions, decrements session refs, and detaches the control client when the last channel for that session closes.

## Local Server Behavior

The local WebSocket handler chooses transport from the requested URL:

- Normal session URLs keep the existing local tmux transport.
- `/r/<host>/<session>` uses `RemoteAgentTransport`.

The local side maps one browser WebSocket to one remote `channelId`.

Remote `pty-out` frames are sent to the browser as terminal bytes. Remote `server-msg` frames are sent to the browser with the existing `TT` framing. Browser JSON messages are forwarded as `client-msg`, except for purely local connection management that remains local.

When the last channel for a remote host closes, the local server keeps the SSH agent warm for a 60 second idle timeout. On server shutdown, all agents must receive `shutdown` and then be killed if they do not exit promptly.

## Session Switching

Remote session switching must preserve the current tmux-web invariant: the visible PTY client state is the source of truth for what the user sees, not the control client alone.

The remote agent performs the actual PTY client switch and verifies the PTY client’s session using the same principle as the local session-switch fix: do not acknowledge a switch to the browser until the PTY-side state has been verified.

After a successful switch, the channel remains the same but its associated session ref moves from the old session to the new one. Control-client refs, title subscriptions, scrollbar subscriptions, and window state move with it.

## Backpressure and Failure Handling

The framed protocol must preserve backpressure at the SSH process boundary. The implementation should centralize writes through one frame writer per agent process so large output from one channel cannot corrupt frames from another.

Failure cases:

- SSH process exits: all channels fail with a clear remote-disconnected message and the browser WebSockets close or reconnect according to existing behavior.
- Remote `tmux-web` is missing or too old: handshake fails with a clear error that includes the remote command that failed.
- One channel PTY exits: only that channel receives `ptyExit`; sibling channels stay open.
- Remote control client fails: agent should keep PTY bytes flowing and degrade control-backed UI features where current local behavior already has fallbacks.
- Protocol version mismatch: fail during `hello` before opening channels.

## Security

The remote host alias is not a shell command. Local tmux-web must spawn `ssh` with argv array form and pass the host alias as a single argument.

No SSH passwords or private-key material are handled by tmux-web. Hardware-key prompts happen in OpenSSH.

The remote command should be a fixed argv sequence:

```text
tmux-web --stdio-agent
```

Future configuration can allow a custom remote command, but that is out of scope for the first implementation.

## Testing

Unit tests should cover:

- frame encode/decode, including partial reads and multiple frames in one chunk
- channel routing and interleaving
- agent manager lifecycle and idle shutdown
- host alias validation
- channel cleanup and session ref-counting
- handshake version mismatch

Integration tests should use fake SSH commands that execute a local `tmux-web --stdio-agent` process or a small fixture agent over stdio. Tests must not require a real SSH server.

Existing local tmux behavior must remain covered by current tests. Remote transport tests should focus on protocol correctness and parity for open, input, resize, server messages, PTY exit, and session switching.

## Non-Goals

- No session manager UI.
- No direct raw multi-SSH tmux transport.
- No remote HTTP forwarding mode.
- No shared PTY clients across browser tabs.
- No custom SSH credential storage.
- No Windows target.
