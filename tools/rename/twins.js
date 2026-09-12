'use strict';
/*
	Removes the English comment twins that the rename has made identical to the line above them.

	The upstream convention doubled every Russian line with an English translation in a comment:

	    function Here(sRecord) {
	    // function Here(sRecord) {

	Once the identifiers moved to English the two lines say exactly the same thing, and the comment
	is nothing but noise — the reader has to check twice that they still agree.

	**Only an exact match counts.** The comparison normalises whitespace and nothing else: no
	fuzzy matching, no ignoring punctuation, no "close enough". A comment that still says anything
	the code does not say is a comment that carries information, and it stays. That includes the
	twins whose translation was never finished — they are the map of what is left to do.

	Three comment syntaxes, because the same convention runs through the scripts, the stylesheets
	and the markup.

	Usage: node twins.js [--dry]
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DRY = process.argv.includes('--dry');
const IGNORE = /^(player-english-translating-test|player-GabePc)\.js$/;

const norm = (s) => s.trim().replace(/\s+/g, ' ');

// Rend le contenu d'une ligne de commentaire, ou null si ce n'en est pas une.
const commentBody = (ligne, ext) => {
	const t = ligne.trim();
	if (ext === '.js' || ext === '.css') {
		if (ext === '.js' && t.startsWith('//')) return t.slice(2).trim();
		// Un commentaire CSS d'une seule ligne : /* ... */
		const m = t.match(/^\/\*\s?(.*?)\s?\*\/$/);
		if (m) return m[1].trim();
		return null;
	}
	if (ext === '.html') {
		const m = t.match(/^<!--\s?(.*?)\s?-->$/);
		return m ? m[1].trim() : null;
	}
	return null;
};

const rapport = [];
let totalRetire = 0;

for (const f of fs.readdirSync(ROOT)) {
	const ext = path.extname(f).toLowerCase();
	if (!['.js', '.css', '.html'].includes(ext)) continue;
	if (IGNORE.test(f)) continue;
	const p = path.join(ROOT, f);
	if (!fs.statSync(p).isFile()) continue;

	const lignes = fs.readFileSync(p, 'utf8').split('\n');
	const garder = [];
	let retire = 0;
	for (let i = 0; i < lignes.length; i++) {
		const corps = commentBody(lignes[i], ext);
		// Le jumeau suit immediatement sa ligne, et dit exactement la meme chose.
		if (corps !== null && i > 0 && garder.length
			&& norm(garder[garder.length - 1]) === norm(corps)
			&& norm(corps) !== '') {
			retire++;
			continue;
		}
		garder.push(lignes[i]);
	}
	if (!retire) continue;
	rapport.push([f, retire, lignes.length]);
	totalRetire += retire;
	if (!DRY) fs.writeFileSync(p, garder.join('\n'), 'utf8');
}

const l = [];
l.push((DRY ? 'ESSAI A BLANC — ' : '') + 'retrait des jumeaux devenus identiques');
l.push('');
for (const [f, n, total] of rapport) {
	l.push('  ' + f.padEnd(22) + String(n).padStart(5) + ' lignes retirees sur ' + total);
}
l.push('');
l.push('  total retire : ' + totalRetire + ' lignes');
const texte = l.join('\n');
fs.writeFileSync(path.join(__dirname, 'twins-report.txt'), texte, 'utf8');
console.log(texte);
