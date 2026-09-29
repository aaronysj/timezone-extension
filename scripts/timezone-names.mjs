/** Every IANA name (Zone and Link, both sides) from the pinned `tzdata` npm package; string values are links. */
export const tzdataNames = (tzdata) => Object.entries(tzdata.zones).flatMap(([name, target]) => (typeof target === 'string' ? [name, target] : [name]));
export const fileName = (zone) => `${zone.replace(/[^a-zA-Z0-9-]/g, '_')}.js`;
