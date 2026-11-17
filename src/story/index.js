import { CH1 } from './ch1.js';
import { CH2 } from './ch2.js';
import { CH3 } from './ch3.js';
import { CH4 } from './ch4.js';
import { CH5 } from './ch5.js';
import { CHX } from './chx.js';
import { CHR } from './chr.js';

/** Main story in play order, then side jobs (side: true) and races. */
export const STORY = [...CH1, ...CH2, ...CH3, ...CH4, ...CH5, ...CHX, ...CHR];
