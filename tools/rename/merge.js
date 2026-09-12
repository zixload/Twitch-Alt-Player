'use strict';
// Applique overrides.json par-dessus la carte extraite. Les correctifs gagnent toujours.
const fs = require('fs');
const path = require('path');
const mined = JSON.parse(fs.readFileSync(path.join(__dirname, 'mined-map.json'), 'utf8'));
const over = JSON.parse(fs.readFileSync(path.join(__dirname, 'overrides.json'), 'utf8'));
const merged = Object.assign({}, mined, over);
fs.writeFileSync(path.join(__dirname, 'merged-map.json'), JSON.stringify(merged, null, 1), 'utf8');
console.log('carte fusionnee : %d entrees extraites + %d correctifs = %d',
	Object.keys(mined).length, Object.keys(over).length, Object.keys(merged).length);
