'use strict';

{
	function insertOnPage() {
	// function insertIntoPage() {
		const script = document.createElement('script');
		// MV3-compliant: Injects the script by URL instead of using textContent.
		script.src = chrome.runtime.getURL('gql_injection.js');
		(document.head || document.documentElement).appendChild(script);
		// The script is removed from the DOM after it has been added, but it will continue to execute.
		script.remove();
	}
	insertOnPage();
	// insertIntoPage();
}