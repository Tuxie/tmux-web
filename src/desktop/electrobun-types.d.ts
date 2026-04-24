// Electrobun 1.16.0's public Bun API imports `three` but does not ship its
// declaration package, and tmux-term does not use those Three.js exports.
declare module 'three';
