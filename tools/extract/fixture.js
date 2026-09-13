'use strict';
/*
	A tiny extension, written from scratch, for the extraction tests to work on.

	The first version of extract-selftest.js used the real extension, and m_Notification as its
	guinea pig. It broke the day m_Notification was really extracted: the module was no longer in
	player.js, and every case failed for that reason alone. A tool meant to carry a whole phase must
	not depend on how far that phase has got.

	So the behaviour is proved here, on shapes chosen to hold every trap at once and to never move:

	  shared.js   loaded by the page AND by the content scripts — the two-context case (common.js)
	  core.js     a prelude of helpers, three modules, and the start-up call at the end
	  content.js  the twitch.tv world
	  page.html   the extension page

	  m_Leaf            touches nothing at build time            -> extracts anywhere
	  m_NeedsPrelude    calls Helper(), defined in core.js       -> must load after core.js,
	                    and the start-up reaches it by a then    -> must load before core.js
	                                                                = refused until the start-up moves
	  m_Forbidden       calls m_Leaf while being built           -> refused by the construction rule

	The real extension is still used, by extract-selftest.js, for the realism cases: that a real
	module extracts and that nothing else moves.
*/
const fs = require('fs');
const path = require('path');

const FILES = {
	'manifest.json': `{
  "manifest_version": 3,
  "name": "fixture",
  "version": "1.0",
  "content_scripts": [
    {
      "matches": [
        "https://www.twitch.tv/*"
      ],
      "js": [
        "shared.js",
        "content.js"
      ],
      "run_at": "document_start"
    }
  ]
}
`,
	'page.html': `<!doctype html>
<html>
<head>
<meta charset=utf-8>
<title>fixture</title>
<script src=shared.js defer></script>
<script src=core.js defer></script>
<script src=extra.js defer></script>
</head>
<body>
<div id=leafnode></div>
<div id=widget></div>
</body>
</html>
`,
	'shared.js': `"use strict";

const IS_CONTENT_SCRIPT = typeof document === "undefined";

function Check(bCondition) {
  if (!bCondition) {
    throw new Error("Check");
  }
}

// Le journal : construit en lisant une constante de ce fichier, appele par tout le monde.
const m_Log = (() => {
  const LIMIT = 500;
  const ring = IS_CONTENT_SCRIPT ? null : [];
  function Here(sText) {
    Check(typeof sText === "string");
    if (ring !== null && ring.length < LIMIT) {
      ring.push(sText);
    }
  }
  return {
    Here,
  };
})();
`,
	'core.js': `"use strict";

const PRELUDE_VALUE = 3;

function Helper(sName) {
  m_Log.Here("[Helper] " + sName + " " + PRELUDE_VALUE);
  return sName;
}

const m_Leaf = (() => {
  let _nCount = 0;
  function Go(sWhat) {
    m_Log.Here("[Leaf] " + sWhat);
    _nCount += 1;
    return _nCount;
  }
  return {
    Go,
  };
})();

const m_NeedsPrelude = (() => {
  const sName = Helper("build");
  function Run() {
    m_Leaf.Go(sName);
  }
  return {
    Run,
  };
})();

const m_Forbidden = (() => {
  m_Leaf.Go("pendant la construction");
  function Nothing() {
    return 0;
  }
  return {
    Nothing,
  };
})();

function Start() {
  m_NeedsPrelude.Run();
}

Promise.resolve().then(Start);
`,
	'extra.js': `"use strict";

const m_Widget = (() => {
  function Paint() {
    document.getElementById("widget").textContent = String(m_Leaf.Go("paint"));
  }
  return {
    Paint,
  };
})();
`,
	'content.js': `"use strict";

const m_Dup = {
  Name: "content",
};

m_Log.Here("[content] demarrage");
`,
};

// m_Dup existe aussi dans le monde de la page : le cas « declare deux fois ».
FILES['extra.js'] += `
const m_Dup = {
  Name: "page",
};
`;

const write = (dir) => {
	fs.mkdirSync(dir, { recursive: true });
	for (const [f, text] of Object.entries(FILES)) fs.writeFileSync(path.join(dir, f), text, 'utf8');
	return dir;
};

module.exports = { write, FILES };
