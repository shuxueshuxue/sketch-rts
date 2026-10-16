// @@@lockstep-cadence - A lockstep client sends its world checksum on every tick that is a multiple of this, and the room
// host hashes its own world on exactly those ticks to compare: one value for both sides, so neither hashes the whole
// world on the ticks in between.
export const LOCKSTEP_CHECKSUM_EVERY_TICKS = 20;
