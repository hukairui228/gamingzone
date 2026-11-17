// Global game state container (single shared object to keep module wiring simple).
import { Emitter } from './util.js';

export const G = {
  scene: null, camera: null, renderer: null, composer: null,
  world: null, sky: null, fx: null, audio: null, hud: null, input: null,
  player: null, vehicles: [], peds: [], traffic: null, pedSys: null, police: null,
  missions: null, activities: null, weapons: null, pickups: null,
  time: 0,           // real seconds since start
  dt: 0,
  timeScale: 1,      // bullet time
  hour: 18.55,        // in-game clock
  paused: true,
  started: false,
  events: new Emitter(),
  settings: {
    quality: 'high', sensitivity: 1, volume: 0.8, music: 0.55, timeSpeed: 1, fov: 70, invertY: false, showFps: false,
  },
  save: null, // persistent progress object
  waypoint: null,
};

export function defaultSave() {
  return {
    money: 500,
    mission: 0,         // index of next story mission
    weapons: { fist: 1 },
    ammo: {},
    armor: 0,
    badges: [],         // collected neon badges ids
    stunts: [],
    garageCar: null,    // {type, color, glow, engine, armor, nitro}
    unlocked: { garage: false, supercar: false },
    stats: { kills: 0, carsStolen: 0, distance: 0, bestDrift: 0, maxWanted: 0, taxiFares: 0, racesWon: 0, playTime: 0, deaths: 0, busted: 0 },
    territories: null,
    properties: [],
    hour: 18.55,
  };
}
