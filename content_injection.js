// content_injection.js
'use strict';

(() => {
    // This self-executing function contains the code previously injected by content.js
    // This is the Manifest V3 compatible way to run code in the page's MAIN world.

    // Function from content.js: перехватитьФункции()
    // Function from content.js: interceptFunctions()
    let _bDoNotIntercept = false;
    window.addEventListener('tw5-nointercept', () => {
    // window.addEventListener('tw5-donotintercept', () => {
        _bDoNotIntercept = true;
    });
    const oTitleDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
    Object.defineProperty(document, 'title', {
        configurable: oTitleDescriptor.configurable,
        enumerable: oTitleDescriptor.enumerable,
        get() {
            return oTitleDescriptor.get.call(this);
        },
        set(title) {
            if (_bDoNotIntercept) {
                oTitleDescriptor.set.call(this, title);
            } else if (this.documentElement.hasAttribute('data-tw5-redirect')) {} else {
            // } else if (this.documentElement.hasAttribute('data-tw5-redirect')) {} else {
                oTitleDescriptor.set.call(this, title);
                window.dispatchEvent(new CustomEvent('tw5-titlechanged'));
                // window.dispatchEvent(new CustomEvent('tw5-titlechanged'));
            }
        }
    });
    const fPushState = history.pushState;
    history.pushState = function (state, title) {
        if (_bDoNotIntercept) {
            fPushState.apply(this, arguments);
        } else if (document.documentElement.hasAttribute('data-tw5-redirect')) {} else {
        // } else if (document.documentElement.hasAttribute('data-tw5-redirect')) {} else {
            const sWas = location.pathname;
            fPushState.apply(this, arguments);
            if (sWas !== location.pathname) {
                oTitleDescriptor.set.call(document, 'Twitch');
                window.dispatchEvent(new CustomEvent('tw5-pushstate'));
            }
        }
    };

    // Function from content.js: разрешитьРаботуЧата()
    // Function from content.js: allowChatToWork()
    const fGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (sName) {
        let sValue = fGetItem.apply(this, arguments);
        if (sName === 'TwitchCache:Layout' && sValue) {
            sValue = sValue.replace('"isRightColumnClosedByUserAction":true', '"isRightColumnClosedByUserAction":false');
        }
        return sValue;
    };

})();