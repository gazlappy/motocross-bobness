// The bikes you can ride, as in the original: 125cc and 250cc two-strokes and a 250cc four-stroke.
// They share a chassis; the engines differ (torque curve, revs, gearing and sound).

export type BikeId = '125' | '250' | '250f';

export interface BikeSpec {
  id: BikeId;
  name: string;
  blurb: string;
  /** Career price, dollars. */
  price: number;
  /** Nm at the crank, and the curve as [rpm, fraction of peak]. */
  peakTorque: number;
  torqueCurve: [number, number][];
  idle: number;
  redline: number;
  shiftUp: number;
  shiftDown: number;
  finalDrive: number;
  /** Fires every other revolution: deeper, thumpier exhaust. */
  fourStroke: boolean;
}

export const BIKES: Record<BikeId, BikeSpec> = {
  '125': {
    id: '125',
    name: '125cc two-stroke',
    blurb: 'Light and screaming. Keep it on the pipe or it bogs.',
    price: 0,
    peakTorque: 25,
    torqueCurve: [[0, 0.3], [1800, 0.34], [5000, 0.55], [8000, 0.8], [10500, 1], [12500, 0.86], [13500, 0.6], [14500, 0]],
    idle: 1800,
    redline: 13500,
    shiftUp: 12600,
    shiftDown: 8200,
    finalDrive: 11.2,
    fourStroke: false,
  },
  '250': {
    id: '250',
    name: '250cc two-stroke',
    blurb: 'The classic. Hard-hitting powerband, big top end.',
    price: 6000,
    peakTorque: 38,
    torqueCurve: [[0, 0.4], [1600, 0.45], [4000, 0.68], [7000, 0.95], [8500, 1], [10500, 0.86], [11500, 0.6], [12500, 0]],
    idle: 1600,
    redline: 11500,
    shiftUp: 10400,
    shiftDown: 5200,
    finalDrive: 10,
    fourStroke: false,
  },
  '250f': {
    id: '250f',
    name: '250cc four-stroke',
    blurb: 'Torque everywhere. Drives out of turns like nothing else.',
    price: 15000,
    peakTorque: 42,
    torqueCurve: [[0, 0.55], [1500, 0.62], [3000, 0.8], [5000, 0.95], [7000, 1], [9500, 0.9], [10800, 0.65], [11800, 0]],
    idle: 1500,
    redline: 10800,
    shiftUp: 9900,
    shiftDown: 4500,
    finalDrive: 9.8,
    fourStroke: true,
  },
};

export const BIKE_IDS = Object.keys(BIKES) as BikeId[];
