"use strict";
/**
 * ! ver 1.80 : change from function to class
 * ! ver 1.81 : bug fix - preserve spaces and algorithm of finding last tag closure
 * ! ver 1.82 : bug fix - insertSync error
 * ! ver 1.83 : remove renderpart functions - no use
 * ! ver 1.90 : Use worker
 * ! ver 2.00 : add appendHTML and appendCSS
 * ! ver 2.01 : extend usage of template into attributes
 * ! ver 2.10 : extend components usage as a simple variable or a function
 * ! ver 2.20 : bug fix on existing classes and add function of templates in meta tag
 * ! ver 2.30 : improve on multiple templates in attributes
  * Render and sync state changes of variable to HTML and CSS using template literals 
 * @class
 * @param {string} openDelimiter start tag of template
 * @param {string} closeDelimiter end tag of template
 * @param {string} syncClass class name to update
 * @param {string} startUrl if syncUrl is not defined for render(), startUrl can be loaded.
 */
class eTemplate {
    constructor({
        openDelimiter = "<%", closeDelimiter = "%>", syncClass = "et_sync", startUrl = "", urlList = []
    } = {}) {
        this.htmlCode = []; // categorized HTML codes
        this.htmlType = []; // categorized types of codes, "JS":template or "HTML"
        this.htmlSync = []; // numbers of code block
        this.cssRules = []; // virtual CSS rules for state change
        this.cssCode = []; // categorized CSS scripts
        this.cssType = []; // categorized CSS types of scripts, "JS":template or "HTML":CSS
        this.syncCnt = 0; // number of sync to update
        this.templateInClass = []; // template in class
        this.titleCode = ""; // HTML for title 
        this.metaArray = []; // META info with templates
        this.startUrl = startUrl; // default url replacing index.html
        this.syncClass = syncClass; // class name to update
        this.openDelimiter = openDelimiter; // start tag of template
        this.closeDelimiter = closeDelimiter; // end tag of template
        this.commentDelimiter = openDelimiter + "%"; // start tag of comment template
        this.preRead = []; // stored and integrated codes from web workers 
        this.urlList = urlList; // urls to read in advance while the first page is being loaded
        this.fileName = ""; // current filename to render
        this.scripts = []; // temporarily stored scripts
        this.currentHash = ""; 
    }

    /**
     * !Interpret CSS and HTML with templates and Render them
     * @param {string} fileName filename to render in <body>
     * @param {object} scroll Object for scroll in rendered page
     * @param {string} scroll.id Id to find for scroll
     * @param {string} scroll.position position of elements with ID to scroll
     * @param {string} scope scope for interpret. "": CSS and HTML, "body": only HTML
     */

    async render({ url: fileName = "", scroll = {}, scope = "" } = {}, callback = function() {} ) {
         /**
         * ! Priority of fileName
         * 1. url in fileName
         * 2. url in startUrl
         * 3. this file's url
         */
        this.syncCnt = 0;
        // if there is no object and only function
        if (typeof arguments[0] === 'function') callback = arguments[0];        
        fileName = fileName === "" ? (this.startUrl !== "" ? this.startUrl : this.currentUrl().filename) : fileName;
        // adjust relative pathname to match host url
        fileName = this.verifyFilename(fileName);
        this.urlList = this.urlList.map(url => this.verifyFilename(url));
        // added workers
        let index = this.urlList.indexOf(fileName) || 0;
        let joinedHTML = '';
        this.fileName = fileName;

        if (this.preRead.length == 0) {     
            // if it's the first time to render, preRead() unless ther is no urlList
            if (this.urlList.length > 0) this.preReadFiles(this.urlList, scope);
            let myUrl = this.currentUrl().host + fileName;        
            //  read first layer HTML
            const RESPONSE = await fetch(myUrl);
            const CURRENTHTML = await RESPONSE.text();
            // read META
            this.readMeta(CURRENTHTML);
            this.changeMeta();
            // change title
            this.getTitle(CURRENTHTML);        
            this.changeTitle(this.titleCode);
            // read multiple layers and proceed
            const RESULT = await this.readFurther(CURRENTHTML, scope);
            // add scripts to interpreted htmlBlock
            joinedHTML = RESULT.htmlBlock.join('') + this.scripts.join('');
            // variables for sync()
            this.htmlCode = RESULT.codeList.code;
            this.htmlType = RESULT.codeList.type;        
        } else {        // already has pre-read pages
            let fileIncludedHTML = this.preRead[index].fileIncludedHTML;
            let cssText = this.preRead[index].cssText;
            this.titleCode = this.preRead[index].titleCode;
            this.metaArray = this.preRead[index].metaArray;
            this.templateInClass = [];
            this.syncCnt = 0;
            this.changeMeta();
            // change title
            this.changeTitle(this.titleCode);
            // chanes CSS
            if (scope !== "body") this.changeCssFromCombinedStyle(cssText);        
            // insert nested HTML modules
            let moduleIncludedHTML = this.insertModules(fileIncludedHTML);
            const RESULT = await this.readFurtherFromCombinedHTML(moduleIncludedHTML);
            joinedHTML = RESULT.htmlBlock.join('');
            this.htmlCode = RESULT.codeList.code;
            this.htmlType = RESULT.codeList.type;    
        }

        // remove current content of body and insert new content
        this.removeAllChildNodes(document.querySelector("body"));
        document.body.insertAdjacentHTML("afterbegin", joinedHTML);

        if (scroll != {} && Object.keys(scroll).length != 0) {
            let targetElement = document.getElementById(scroll.id);
            let blockArr = ["start", "center", "end"];
            let isInBlock = blockArr.some((el) => el == scroll.position);
            scroll.position = isInBlock ? scroll.position : "center";
            if (targetElement !== null) targetElement.scrollIntoView({ block: scroll.position });
        }
        document.body.style.display = "block";
        callback();
        return new Promise((resolve, reject) => { resolve('done'); });
    }

    /**
     * Spawn web workers of preloading and combining each pages
     * @method
     * @async
     * @param {array} urlList list of filenames used in this website
     * @param {string} scope scope to check templates
     * @returns nothing
     */
    async preReadFiles(urlList, scope) {
        let workers = [];
        for(let i=0; i<urlList.length; i++) {
            const path = new URL(urlList[i], this.currentUrl().host).href;
            workers[i] = (new Worker(this.currentUrl().host + 'js/worker.min.js'));
            workers[i].postMessage({path, scope});
            workers[i].onmessage = (e) => {
                this.preRead[i] = e.data;
                workers[i].terminate();
            }
        }
        return;
    }

    /**
     * find scripts from HTML text, store temporarily and return script removed HTML text
     * @method
     * @param {string} currentHTML scope to check templates
     * @returns {string} script removed HTML text
     */
    storeScript(currentHTML) {
        const BODY_REGEX = /<body*?>(\n|\r|\t|.)*/gm;
        const SCRIPT_REGEX = /<script[\s\S]*?>[\s\S]*?<\/script>/gm;
        let scripts = [];
        this.scripts = scripts;
        let temp = currentHTML.match(BODY_REGEX);
        if (temp === null) return currentHTML;
        scripts = temp[0].match(SCRIPT_REGEX, "");
        if (scripts === null ) return currentHTML;
        scripts.forEach(script => currentHTML = currentHTML.replace(script, ""));
        this.scripts = scripts;
        return currentHTML;
    }

    /**
     * read further nested HTML and process
     * @method
     * @async
     * @param {string} currentHTML source HTML text which was loaded firstly (not interpreted yet)
     * @param {string} scope scope for interpret. "": CSS and HTML, "body": only HTML
     * @returns {object} htmlBlock: interpreted codes array / codeList: object of code and type
     */
     async readFurther(currentHTML, scope) {
        // remove comments
        currentHTML = this.removeComment(currentHTML);
        // remove scripts in body
        currentHTML = this.storeScript(currentHTML);
        // CSS change in HEAD
        if (scope !== "body") await this.changeCss(currentHTML); 
        // insert nested HTML files
        let { fileIncludedHTML, codeList } = await this.insertNestedHTML(currentHTML);
        // insert nested HTML modules
        let moduleIncludedHTML = this.insertModules(fileIncludedHTML);
        // categorize codes
        let { types, codes } = this.seperateCode(moduleIncludedHTML, "second");
        // make code blocks like for, if, switch...
        let sync = this.makeSyncBlock(types, codes);
           // add "HTML" if first code="JS"
        if (types[0] == "JS") {
            types.unshift("HTML");
            codes.unshift(" ");
            sync = sync.map(x => x + 1);
            sync.unshift(0);
        }
        // insert class or span tag for refreshing templates
        codeList = this.insertSync(types, codes, sync);
        this.htmlSync = sync;
        this.syncCnt = codeList.syncCnt;
        // interprete template scripts
        let htmlBlock = this.interpret(types, codes);
        return new Promise((resolve, reject) => {
            resolve({ htmlBlock, codeList });
        });
    }

    /**
     * read further from stored HTML and process
     * @method
     * @async
     * @param {string} currentHTML source HTML text which was loaded firstly (not interpreted yet)
     * @returns {object} htmlBlock: interpreted codes array / codeList: object of code and type
     */
    async readFurtherFromCombinedHTML(fileIncludedHTML) {
        // insert nested HTML modules
        let moduleIncludedHTML = this.insertModules(fileIncludedHTML);
        // categorize codes
        let { types, codes } = this.seperateCode(moduleIncludedHTML, "second");
        // make code blocks like for, if, switch...
        let sync = this.makeSyncBlock(types, codes);
        // add "HTML" if first code="JS"
        if (types[0] == "JS") {
            types.unshift("HTML");
            codes.unshift(" ");
            sync = sync.map(x => x + 1);
            sync.unshift(0);
        }
        // insert class or span tag for refreshing templates
        let codeList = this.insertSync(types, codes, sync);
        this.htmlSync = sync;
        this.syncCnt = codeList.syncCnt;
        // interprete template scripts
        let htmlBlock = this.interpret(types, codes);
        return { htmlBlock, codeList };
    }

    /**
     * updates applied templates both on HTML and CSS if there are variable changes.
     * @param {string} scope updating scope, whether it updates only HTML or also CSS.    
     * @returns nothing
     */
    sync(scope) {
        let temp = "";
        let eClass = this.syncClass;
        const classtext = '${eClass}_';
        const classRegex = new RegExp(classtext);
        // check and change meta info
        this.changeMeta();
        // check and change title
        this.changeTitle(this.titleCode);
        // change related variables from input values
        const inputEls = document.querySelectorAll(`input.${eClass}`);
        for (let i = 0; i < inputEls.length; i++) {
            let cList = inputEls[i];
            temp = cList.getAttribute("data-sync");
            if (temp == null) continue;
            let isQuote = (cList.type=="number") ? '' : '"';
            temp += "=" + (cList.value ? `${isQuote}${this.escapeHtml(cList.value)}${isQuote};` : '"";');
            try { this.controlCode(temp); } 
            catch (error) { return error; }
        }

        // interprete registered templates
        let htmlBlock = this.interpretPart(this.htmlType, this.htmlCode);

        // change current template to newly interpreted templates
        const eclassEls = document.querySelectorAll(`.${eClass}`);
        for (let i = 0; i < eclassEls.length; i++) {
            let cList = eclassEls[i];
            let classLists = [...cList.classList];

            // get attribute to change from class and index of sync count
            let classes = classLists.find(el => el.startsWith(eClass+'_'));
            let isTemplateInAttribute = (classes !== undefined) ? true : false;
            let classCnt = classLists.find(el => el.startsWith(eClass+'Cnt'));
            let index = (classCnt !== undefined) ? parseInt(classCnt.replace(`${eClass}Cnt`, ""), 10) : 0;

            if (!isTemplateInAttribute) {
                if (cList.innerHTML == htmlBlock[index]) continue;
                this.removeAllChildNodes(cList);
                cList.insertAdjacentHTML("afterbegin", htmlBlock[index]);
                continue;                
            }

            for (let j = 0; j < htmlBlock[index].length; j++) {
                // if didn't change, continue
                if (this.templateInClass[index][j][1] == htmlBlock[index][j]) continue;
                // attribute: class
                if (this.templateInClass[index][j][0] == "class") {
                    cList.classList.remove(this.templateInClass[index][j][1]);
                    cList.classList.add(htmlBlock[index][j]);
                    this.templateInClass[index][j][1] = htmlBlock[index][j];
                // attribute: data
                } else if (this.templateInClass[index][j][0].includes('data-')){
                    let datasetName = this.templateInClass[index][j][0].substring(this.templateInClass[index][j][0].indexOf('data-')+5);
                    temp = cList.dataset[datasetName];
                    temp = temp.replace(this.templateInClass[index][j][1], htmlBlock[index][j]);
                    cList.dataset[datasetName] = temp;
                    this.templateInClass[index][j][1] = htmlBlock[index][j];
                // attribute: others
                } else {
                    temp = cList.getAttribute(this.templateInClass[index][j][0]);
                    temp = temp.replace(this.templateInClass[index][j][1], htmlBlock[index][j]);
                    cList.setAttribute(this.templateInClass[index][j][0], temp);
                    this.templateInClass[index][j][1] = htmlBlock[index][j];
                }
            }
        }
        if (scope != "body") this.syncCss();
    }

    /**
     * update templates in CSS that changed there are changes in variables 
     * @returns nothing
     */
    syncCss() {
        // if there is no template in CSS, go back
        if (this.cssType.length == 0 || !this.cssType.includes("JS")) return;
        // interpret seperated CSS and parse it to CSS rules
        let htmlBlock = this.interpret(this.cssType, this.cssCode);
        let cssRules = this.parseCSS(htmlBlock.join("")); // new rules of CSS
        // find combined style tag
        let sheetNo = 0;
        for (let i = 0; i < document.styleSheets.length; i++) {
            if (document.styleSheets[i].href == null) {
                sheetNo = i;
                break;
            }
        }
        const emptySpace = /\s+|\\n/g;
        let oRules = this.cssRules; // old rules 
        let oRulesLen = oRules.length;
        let modifiedCss = "";
        let toAdd = []; // temporarily stores rules to add
        let updatedRules = []; // temporarily stores rules to update
        let cssRulesLen = cssRules.length; 
        // check and update CSS change
        for (let i = 0; i < cssRulesLen; i++) {
            let cssRule = cssRules[i];
            let cssType = cssRule.type == undefined ? "" : cssRule.type;
            let currentIndex = -1;
            let typeNo = 0;
            let selector = "";
            switch (cssType) {
                case "keyframes":
                    for (let ci = 0; ci < oRulesLen; ci++) {
                        let oRule = oRules[ci];
                        let frameSelector = cssRule.styles.substring(0, cssRule.styles.indexOf("{")).trim();
                        let cframeSelector = oRule.styles.substring(0, oRule.styles.indexOf("{")).trim();
                        if (oRule.type == "keyframes" && frameSelector == cframeSelector) {
                            currentIndex = ci;
                            break;
                        }
                    }
                    // if found the same keyframes rules, change to new one
                    if (currentIndex == -1) {
                        toAdd.push(["rule", i, -1, -1, cssRule.styles]);
                        break;
                    }
                    let oldText = oRules[currentIndex].styles;
                    let newText = cssRule.styles;
                    if (oldText.replace(emptySpace, "") != newText.replace(emptySpace, "")) {
                        document.styleSheets[sheetNo].deleteRule(currentIndex);
                        document.styleSheets[sheetNo].insertRule(newText, currentIndex);
                    }
                    updatedRules.push([currentIndex, -2, 0, 7]);
                    break;
                case "media":
                case "supports":
                    typeNo = cssType == "media" ? 4 : 12;

                    for (let ci = 0; ci < oRulesLen; ci++) {
                        let oRule = oRules[ci];
                        if (oRule.type == cssType && cssRule.selector == oRule.selector) {
                            currentIndex = ci;
                            break;
                        }
                    }
                    if (currentIndex == -1) {
                        modifiedCss = cssRule.selector + " {\n";
                        let cssRuleSubStylesLen = cssRule.subStyles.length;
                        for (let j = 0; j < cssRuleSubStylesLen; j++) {
                            let subStyle = cssRule.subStyles[j];
                            modifiedCss +="    " + subStyle.selector + " {\n";
                            let subStyleRulesLen = subStyle.rules.length;
                            for (let k = 0; k < subStyleRulesLen; k++) {
                                modifiedCss +=`        ${subStyle.rules[k].key}: ${subStyle.rules[k].value};\n`;
                            }
                            modifiedCss +="    }\n";
                        }
                        modifiedCss += "}\n";
                        toAdd.push(["rule", i, -1, -1, modifiedCss]);
                        break;                        
                    }
                    
                    for(let j=0; j<cssRule.subStyles.length; j++) {
                        let subStyle = cssRule.subStyles[j];
                        selector = subStyle.selector;
                        let currentSubIndex = -1;
                        let subStylesLen = oRules[currentIndex].subStyles.length;
                        for (let cj = 0; cj < subStylesLen; cj++) {
                            if (oRules[currentIndex].subStyles[cj].selector == selector) {
                                currentSubIndex = cj;
                                break;
                            }
                        }
                        if (currentSubIndex == -1) {
                            modifiedCss = "    " + subStyle.selector + " {\n";
                            for (let k = 0; k < subStyle.rules.length; k++) {
                                modifiedCss += `        ${subStyle.rules[k].key}: ${subStyle.rules[k].value};\n`;
                            }
                            modifiedCss += "    }\n";
                            toAdd.push(["rule", i, j, -1, modifiedCss]);
                            continue;
                        }
                        for (let k=0; k<subStyle.rules.length; k++) {
                            let rule = subStyle.rules[k];
                            let currentStyle = -1;
                            let ruleLen = oRules[currentIndex].subStyles[currentSubIndex].rules.length;
                            for (let ck = 0; ck < ruleLen; ck++) {
                                let styleKey = oRules[currentIndex].subStyles[currentSubIndex].rules[ck].key;
                                if (styleKey == rule.key) {
                                    currentStyle = ck;
                                    break;
                                }
                            }
                            if (currentStyle == -1) {
                                toAdd.push(["style", i, j, k, rule.key, rule.value]);
                                continue;
                            }
                            let key = oRules[currentIndex].subStyles[currentSubIndex].rules[currentStyle].key;
                            let oldValue = oRules[currentIndex].subStyles[currentSubIndex].rules[currentStyle].value;
                            let newValue = rule.value;
                            if (oldValue != newValue) {
                                document.styleSheets[sheetNo].cssRules[currentIndex].cssRules[currentSubIndex].style.setProperty(key, newValue);
                            }
                            updatedRules.push([currentIndex, currentSubIndex, currentStyle, typeNo]);                            
                        }
                    }
                    break;
                case "":
                case "font-face":
                    typeNo = cssType == "font-face" ? 5 : 1;

                    for (let ci = i; ci < oRulesLen; ci++) {
                        let oRule = oRules[ci];
                        if (cssRule.selector == oRule.selector) {
                            currentIndex = ci;
                            break;
                        }
                    }
                    if (currentIndex == -1) {
                        modifiedCss = cssRule.selector + " {\n";
                        let cssRuleRulesLen = cssRule.rules.length;
                        for (let j = 0; j < cssRuleRulesLen; j++) {
                            modifiedCss += `    ${cssRule.rules[j].key}: ${cssRule.rules[j].value};\n`;
                        }
                        modifiedCss += "}\n";
                        toAdd.push(["rule", i, -1, -1, modifiedCss]);
                        break;
                    }
                    let cssRuleRulesLen = cssRule.rules.length;
                    for (let j = 0; j < cssRuleRulesLen; j++) {
                        let rule = cssRule.rules[j];
                        let currentStyle = -1;
                        let oRulesRulesLen = oRules[currentIndex].rules.length;
                        for (let cj = 0; cj < oRulesRulesLen; cj++) {
                            let oldKey = oRules[currentIndex].rules[cj].key;
                            if (oldKey == rule.key) {
                                currentStyle = cj;
                                break;
                            }
                        }
                        if (currentStyle == -1) {
                            modifiedCss = `    ${rule.key}: ${rule.value};\n`;
                            toAdd.push(["style", i, -1, j, rule.key, rule.value]);
                            continue;
                        }
                        let key = oRules[currentIndex].rules[currentStyle].key;
                        let oldValue = oRules[currentIndex].rules[currentStyle].value;
                        let newValue = rule.value;
                        if (oldValue != newValue) document.styleSheets[sheetNo].cssRules[currentIndex].style.setProperty(key, newValue);
                        updatedRules.push([currentIndex, -1, currentStyle, typeNo]);
                    }
                    break;
            }
        }

        // delete rules
        let cssLength = oRules.length;
        let ruleLength = 0;
        let styleLength = 0;
        for (let i = cssLength - 1; i >= 0; i--) {
            let typeNo = 0;
            let oRule = oRules[i];
            switch (oRule.type) {
                case "media":
                case "supports":
                    typeNo = oRule.type == "media" ? 4 : 12;
                    ruleLength = oRule.subStyles.length;
                    for (let j = ruleLength - 1; j >= 0; j--) {
                        styleLength = oRule.subStyles[j].rules.length;
                        for (let k = styleLength - 1; k >= 0; k--) {
                            let isUpdated = this.arrayFind(updatedRules, [i, j, k, typeNo]);
                            if (isUpdated < 0) {
                                let targetProp = oRule.subStyles[j].rules[k].key;
                                document.styleSheets[sheetNo].cssRules[i].cssRules[j].style.removeProperty(targetProp);
                            }
                        }
                        if (document.styleSheets[sheetNo].cssRules[i].cssRules[j].style.length == 0) document.styleSheets[sheetNo].cssRules[i].deleteRule(j);
                    }
                    if (document.styleSheets[sheetNo].cssRules[i].cssRules.length == 0) document.styleSheets[sheetNo].deleteRule(i);
                    break;
                case "":
                case "font-face":
                    typeNo = oRule.type == "" ? 1 : 5;
                    styleLength = oRule.rules.length;
                    for (let j = styleLength - 1; j >= 0; j--) {
                        let isUpdated = this.arrayFind(updatedRules, [i, -1, j, typeNo]);
                        if (isUpdated < 0) {
                            let targetProp = oRule.rules[j].key;
                            document.styleSheets[sheetNo].cssRules[i].style.removeProperty(targetProp);
                        }
                    }
                    if (document.styleSheets[sheetNo].cssRules[i].style.length == 0) document.styleSheets[sheetNo].deleteRule(i);
                    break;
                case 7:
                    let isUpdated = this.arrayFind(updatedRules, [i, -2, 0, 7]);
                    if (isUpdated < 0) document.styleSheets[sheetNo].deleteRule(i);
                    break;
            }
        }

        // add rules
        let toAddLen = toAdd.length;
        for (let i = 0; i < toAddLen; i++) {
            let [addType, rule1, rule2, style1, prop, value = ""] = toAdd[i];
            if (addType != "style") {
                if (rule2 != -1) {
                    document.styleSheets[sheetNo].cssRules[rule1].insertRule(prop, rule2);
                    continue;
                }
                document.styleSheets[sheetNo].insertRule(prop, rule1);
                continue;                
            }
            if (rule2 != -1) {
                document.styleSheets[sheetNo].cssRules[rule1].cssRules[rule2].style.setProperty(prop, value);
                continue;
            }
            document.styleSheets[sheetNo].cssRules[rule1].style.setProperty(prop, value);
        }
        // stores changed rules to this.cssRules
        this.cssRules = JSON.parse(JSON.stringify(cssRules));
    }

    /**
     * find <% include %> template in HTML text
     * @method 
     * @param {string} currentHTML 
     * @returns {object} urls : urls in include template, order : array of code number pointing where the template is, codeList : seperated HTML codes
     */
    findInclude(currentHTML) {
        const bodyRegexp = /< *?body *?>[\s\S]*?< *?\/ *?body>/g;
        const bodyStartRegexp = /< *?body *?>/g;
        const bodyEndRegexp = /< *?\/ *?body *?>/g;
        const includeRegexp = / *?include\( *?["'`](.*?)["'`] *?\)/g;
        const includeStartRegexp = / *?include\( *?["'`]/g;
        const includeEndRegexp = /["'`] *?\).*/g;
        let urls = []; // url for inclusion
        let orders = []; // index of include script out of code array
        let tempString = "";
        let currentBodyHTML = "";
        currentBodyHTML = currentHTML.match(bodyRegexp) === null ? currentHTML : currentHTML.match(bodyRegexp)[0].replace(bodyStartRegexp, "").replace(bodyEndRegexp, "");
        let { codes, types } = this.seperateCode(currentBodyHTML, "first")
        let typeLen =types.length;
        let hostUrl = this.currentUrl().host;
        for (let i = 0; i < typeLen; i++) {
            if (types[i] == "JS" && includeRegexp.test(codes[i])) {
                tempString = codes[i].match(includeRegexp)[0].replace(includeStartRegexp, '').replace(includeEndRegexp, '');
                urls.push(new URL(tempString, hostUrl).href);
                orders.push(i);
            }
        }

        return {
            urls,
            orders,
            codeList: codes,
        };
    }

    /**
     * Insert nested HTML text from external files to source HTML text
     * @method
     * @param {string} currentHTML HTML text source with nested files
     * @returns {object} fileIncludedHTML : HTML text with included nested HTML files, codeList: array of seperated codes
     */
    async insertNestedHTML(currentHTML, basePath=[]) {
        let fileIncludedHTML = "";
        let { urls, orders, codeList } = this.findInclude(currentHTML, basePath);
        if (urls.length == 0) {
            fileIncludedHTML = this.removeComment(codeList.join(""));
            return { fileIncludedHTML, codeList };
        }
        let relativeUrls = [];
        urls.forEach((url,i) => {
            relativeUrls.push(this.getComparedPath(url, this.currentUrl().host));
        });
        let insertedHTMLs = await this.getTextFromFiles(urls);

        for (let i=0; i<insertedHTMLs.length; i++) {
            insertedHTMLs[i] = this.htmlReplaceRelativeUrl(insertedHTMLs[i], relativeUrls[i]);
        }
        // insert HTML of files into the places of each include() scripts.
        insertedHTMLs.forEach((insertedHTML, i) => {
            codeList[orders[i]] = insertedHTML;
        });
        fileIncludedHTML = this.removeComment(codeList.join(""));
        return await this.insertNestedHTML(fileIncludedHTML, relativeUrls);
    }

    /**
     * Insert nested HTML text from modules to source HTML text
     * @method
     * @param {string} currentHTML HTML text with nested modules
     * @returns {string} HTML text inserted with modules
     */
    insertModules(currentHTML) {
        const moduleRegexp = /<%#.*?%>/g;
        const moduleStartRegexp = /<%# */g;
        const moduleEndRegexp = / *%>/g;
        let {types, codes} = this.seperateCode(currentHTML, "first");
        let cnt = 0;
        let typeLen = types.length;
        for (let i = 0; i < typeLen; i++) {
            // check whether a code has a module
            if (types[i] == "JS" && codes[i].includes("<%#")) {
                let tempString = ' '+codes[i].match(moduleRegexp)[0].replace(moduleStartRegexp,'').replace(moduleEndRegexp,'');
                try {
                    codes[i] = this.basicCode(tempString);
                    cnt++;
                } catch {
                    codes[i] = `<%= "invalid module" %>`;
                    cnt++
                }
            }
        }
        let result = codes.join("");
        if (cnt !== 0) {
            // recursive call for multi-layer modules
            result = this.insertModules(result);
        }
        return result;
    }

    /**
     * Seperate templates or template blocks out of HTML text  
     * @method
     * @param {string} html HTML text
     * @param {string} calltype "first" seperate templates as they are / "second" seperate only inside of templates delimiters
     * @returns {object.<{code: [array], type: [array]}>} code: array of seperated codes, type: array of code types
     */
    seperateCode(html, calltype) {
        const regexText = `(${this.openDelimiter}[^%][\\s\\S]*?${this.closeDelimiter})`;
        const templateRegex = new RegExp(regexText, "g");
        let codes = html.split(templateRegex);
        let types = [];
        let codesLen = codes.length;
        for (let i = 0; i < codesLen; i++) {
            let code = codes[i];
            let codeType = templateRegex.test(code) ? "JS" : "HTML";
            codes[i] = codeType === "JS" ? calltype === "second" ? code.substring(2, code.length - 2).trim() : code : code;
            types.push(codeType);
        }
        // combine adjcent HTML
        let typeLength = types.length;
        if (typeLength > 1) {
            for (let i = typeLength - 1; i >= 1; i--) {
                if (types[i] == types[i - 1] && types[i] == "HTML") {
                    codes[i - 1] = codes[i - 1] + codes[i];
                    codes.splice(i, 1);
                    types.splice(i, 1);
                }
            }
        }
        return { types, codes };
    }

    /**
     * Interpret each codes and make blocks of interpreted codes 
     * @method
     * @param {array} type type of codes
     * @param {array} code seperated codes by type
     * @returns {array} htmlblock : array of interpreted codes
     */
    interpret(type, code) {
        // declare variables
        let htmlBlock = [];
        let cnt = 0;
        let escapedOpenComment = this.escapeHtml(this.commentDelimiter.replace(this.commentDelimiter, this.openDelimiter));
        let escapedCloseComment = this.escapeHtml(this.closeDelimiter);

        let codeLen = code.length;
        while (cnt < codeLen) {
            switch (type[cnt]) {
                // HTML, as it is
                case "HTML":
                    htmlBlock.push(
                        code[cnt]
                            .replaceAll(this.commentDelimiter, escapedOpenComment)
                            .replaceAll(this.closeDelimiter, escapedCloseComment)
                    );
                    break;
                // JS
                case "JS":
                    // if (code[cnt].substring(0, 1) == "=" || code[cnt].substring(0, 1) == "-") {
                    if (code[cnt].search(/=|-/g) == 0) {                        
                        // sing line script
                        try {
                            htmlBlock.push(this.basicCode(code[cnt]));
                        } catch (error) {
                            htmlBlock.push("invalid template");
                        }
                        break;
                    } else {
                        // multi line script block
                        let blockData = this.eachBlock(type, code, cnt);
                        cnt = blockData.index; // to next block
                        try {
                            htmlBlock.push(this.controlCode(blockData.partBlock));
                        } catch (error) {
                            htmlBlock.push("invalid template");
                        }
                        break;
                    }
            } // switch:end
            cnt++;
        } // for:end
        return htmlBlock;
    }

    /**
     * interpret stored templates for places of templates in HTML
     * @method
     * @param {array} types stored types of template codes
     * @param {array} codes stored template codes  
     * @returns {array} htmlBlock 
     */
    interpretPart(types, codes) {
        // declare variables
        let htmlBlock = [];
        let cnt = -1;
        let lastSync = -1;
        for (let i=0; i<codes.length; i++) {
            let code = codes[i];
            let type = types[i];
            let currentSync = this.htmlSync[i];
            if (currentSync != lastSync && type=="JS") {
                cnt++;
                lastSync = currentSync;
            }
            if (type=="HTML") continue;
            let isBasic = (code.search(/=|-/g) == 0);

            if (isBasic) {
                if (this.templateInClass[cnt]==undefined) {
                    // single line script
                    try {
                        htmlBlock.push(this.basicCode(code));
                    } catch (error) {
                        htmlBlock.push("invalid template script");
                    }
                    continue;
                }
                // template in attributes
                try {
                    if (this.htmlSync[i]!=this.htmlSync[i-1]) {
                        htmlBlock.push([this.basicCode(code)]);
                    } else {
                        htmlBlock[htmlBlock.length - 1].push(this.basicCode(code));                        
                    }
                } catch (error) {
                    htmlBlock.push("invalid template script");
                }
                continue;
            }
            // multi line script block
            let block_data = this.eachBlock(types, codes, i);
            i = block_data.index; // to next block
            try {
                htmlBlock.push(this.controlCode(block_data.partBlock));
            } catch (error) {
                htmlBlock.push("invalid template script");
            }
        }
        return htmlBlock;
    }

    /**
     * seperate blocks of codes
     * @method
     * @param {array} type type of codes
     * @param {array} code seperated codes by type
     * @returns {array} sync : array of sync number of each codes
     */
    makeSyncBlock(type, code) {
        let sync = [];
        let cnt = 0;
        let index = 0;
        let braceBalance = 0;
        let codeLen = code.length;

        for (let i = 0; i < codeLen; i++) {
            switch (type[i]) {
                case "HTML": 
                    sync.push(cnt);
                    break;
                case "JS":
                    if (code[i].search(/=|-/g) == 0) {
                        // sing line script
                        sync.push(cnt);
                        break;
                    } else {
                        // multi line script block
                        let blockEnd = this.findBlockEnd(type, code, i);
                        index = blockEnd.index;
                        braceBalance = blockEnd.braceBalance;
                        if (braceBalance < 0) {
                            console.log("ERROR: missing {");
                        } else if (braceBalance > 0) {
                            console.log("ERROR: missing }");
                        }
                        sync = [...sync, ...Array(index - i + 1).fill(cnt)];
                        i = index; // to next block
                        break;
                    }
            } // switch:end
            cnt++;
        } // for:end
        return sync;
    }

    findBlockEnd(type, code, i) {
        // multi line script block - change
        let bracesCnt = 0;
        let j = 0;
        let codeLen = code.length;
        for (j = i; j < codeLen; j++) {
            // First part of block
            if (j == i && type[j] == "JS") {
                if (code[j].includes("{")) bracesCnt++;
                if (code[j].includes("}")) bracesCnt--;
                if (bracesCnt == 0) return { index: j, error: 0 };
                continue;
            }
            // from the other blocks
            // HTML
            if (type[j] == "HTML") continue;
            // JS
            if (type[j] == "JS" && code[j].search(/=|-/g) !== 0) {
                if (code[j].includes("{")) bracesCnt++;
                if (code[j].includes("}")) bracesCnt--;
                if (bracesCnt == 0) return { index: j, error: 0 };
            }
        }
        if (bracesCnt != 0) return { index: i, braceBalance: bracesCnt };
        // if braces are not closed, change all the JS to HTML
        return { index: j, braceBalance: bracesCnt };
    }

    eachBlock(type, code, i) {
        // multi line script block - change
        let partBlock = "";
        let bracesCnt = 0;
        let codeLen = code.length;
        let j = 0;
        for (j = i; j < codeLen; j++) {
            // First part of block
            if (j == i) {
                if (type[j] == "JS") {
                    if (code[j].includes("{")) bracesCnt++;
                    if (code[j].includes("}")) bracesCnt--;
                    if (bracesCnt == 0) return { partBlock: code[j], index: j };
                    partBlock = `let eTemplateInterpreted=${String.fromCharCode(96)}${String.fromCharCode(96)}; ${code[j]}`;
                    continue;
                } else {
                    partBlock = `let eTemplateInterpreted=${String.fromCharCode(96)}${code[j]}${String.fromCharCode(96)};`;
                }
            }
            // additional blocks
            switch (type[j]) {
                case "HTML":
                    if (this.removeControlText(code[j]).trim() !== "") partBlock += `eTemplateInterpreted += ${String.fromCharCode(96)}${code[j]}${String.fromCharCode(96)};`;
                    continue;
                case "JS":
                    if (code[j].search(/=|-/g) == 0) {
                        partBlock += `eTemplateInterpreted += ${code[j].substring(1)};`;
                    } else {
                        partBlock += code[j];
                        if (code[j].includes("{")) bracesCnt++;
                        if (code[j].includes("}")) bracesCnt--;
                        if (bracesCnt == 0) {
                            partBlock += `; return eTemplateInterpreted;`;
                            return { partBlock: partBlock, index: j };
                        }
                    }
                    break;
            }
        }
        partBlock += `; return eTemplateInterpreted;`;
        return { partBlock: partBlock, index: j };
    }

    insertSync(type, code, sync) {
        let lastSync = -1;
        let startPos = 0;
        let endPos = 0;
        let spacePos = 0;
        let tempStr = "";
        let tagStr = "";
        let prevCode = "";
        let startBlockIndex = 0;
        let endBlockIndex = 0;
        let classStart = 0;
        let attrList = [];
        let syncCnt = this.syncCnt;
        let syncLen = sync.length;
        const eClass = this.syncClass;
        const attrRegex = /[\s]+((-|\w)+) *= *["']/g;
        const beforeClassRegex = /[\s\S]+class[\s]*= *["']/g;

        for (let i = 0; i < syncLen; i++) {

            if (type[i]=="JS") code[i] = code[i].trim();
            if (sync[i] == lastSync || type[i] != "JS") {
                lastSync = sync[i];
                continue;
            }

            lastSync = sync[i];
            classStart = 0;
            startBlockIndex = i;
            endBlockIndex = sync.lastIndexOf(sync[startBlockIndex]);
            prevCode = code[i - 1];
            attrList = [];
            let cleanPrevCode = this.removeControlText(prevCode);
            let endBlank = cleanPrevCode.length - cleanPrevCode.trimEnd().length;
            let lastLetter = cleanPrevCode.substring(cleanPrevCode.length - endBlank - 1).trim();

            if (lastLetter != ">") {
                // previous code is not ended with tag
                endPos = prevCode.lastIndexOf(">");
                startPos = prevCode.lastIndexOf("<");

                // Check template in the middle of prev and next code, which means template is used in attributes

                if (endPos < startPos) { // if in the middle
                    for (let j = i + 1; j < syncLen; j++) {
                        if (type[j] === "HTML" && code[j].indexOf(`>`) > 0) {
                            // adjust sync to the same within the tag
                            for (let k = i + 1; k < j; k++) { 
                                sync[k] = sync[i];
                            }
                            endBlockIndex = sync.lastIndexOf(sync[i]);
                            break;
                        }
                    }
                    // find the attributes
                    let classPos = -1;
                    let currentAttr = '';
                    for (let j= i; j <= endBlockIndex; j++) {
                        if (type[j] === "JS") {
                            for (let k=j-1; k>=0; k--) {
                                let attrL=[...code[k].matchAll(attrRegex)];
                                if (attrL.length>0) {
                                    currentAttr = attrL[attrL.length-1][1];
                                    if (currentAttr == "class") classPos = k;
                                    break;
                                }
                            }
                            if (currentAttr !='') attrList.push(currentAttr);
                        }
                    }

                    // if class doesn't include template, find the position of class, again.
                    for (let j= i-1; j <= endBlockIndex+1; j++) {
                        if (type[j] === "HTML" && code[j].match(attrRegex)!==null && type[j + 1] == "JS") {
                            let classIndex = code[j].lastIndexOf('class');
                            if ((j==i-1) && (classIndex > startPos)) { classPos = j; break; }
                            if (j>i && classIndex < code[j].indexOf('>')) { classPos = j; break; }
                        }
                    }

                    let attrText = [... new Set(attrList)].join("+");
                    let interpretedTemplate = [];
                    for (let j=i; j<=endBlockIndex; j++) {
                        if (type[j] == "JS") interpretedTemplate.push(this.basicCode(code[j].substring(1)));
                    }

                    if (attrList.length>0) {
                        this.templateInClass[syncCnt] = [];
                        attrList.map((attr, j) => {
                            this.templateInClass[syncCnt].push([attr, interpretedTemplate[j]]);
                        });
                    }
                    
                    if (classPos===-1) {
                        // there is no class in the block
                        startPos = prevCode.lastIndexOf("<");
                        endPos = prevCode.indexOf(" ", startPos);
                        code[i - 1] = `${prevCode.substring(0,endPos + 1)} class="${eClass} ${eClass}_${attrText} ${eClass}Cnt${syncCnt}" ${prevCode.substring(endPos + 1)}`;
                        syncCnt++;                            
                    } else {
                        // there is a class in the block
                        let beforeClass = code[classPos].match(beforeClassRegex)[0];
                        let afterClass = code[classPos].replace(beforeClass,'');
                        code[classPos] = `${beforeClass}${eClass} ${eClass}_${attrText} ${eClass}Cnt${syncCnt} ${afterClass}`;
                        syncCnt++;
                    }
                    continue;
                }

                // not in the middle and there is text elements before this template
                code[i - 1] += `<span class="${eClass} ${eClass}Cnt${syncCnt}">`;
                syncCnt++;
                code[endBlockIndex + 1] = "</span>" + code[endBlockIndex + 1];
                continue;
            } 

        // previous code is ended with tag -- start
            startPos = prevCode.lastIndexOf("<");
            endPos = prevCode.lastIndexOf(">");
            spacePos = prevCode.indexOf(" ", startPos);
            tagStr = (spacePos == -1 || spacePos > endPos) ?
                        prevCode.substring(startPos + 1, endPos) :
                        prevCode.substring(startPos + 1, prevCode.length).split(" ")[0];

            // if previous code is ended with end tag
            if (prevCode.substring(startPos, startPos + 2) == "</") {
                code[i - 1] = `${code[i - 1]}<span class="${eClass} ${eClass}Cnt${syncCnt}">`;
                syncCnt++;
                code[endBlockIndex + 1] = `</span>${code[endBlockIndex + 1]}`;
                continue;
            }

            //  if previous code is ended with start tag
            if (code[endBlockIndex + 1].includes("</" + tagStr) && 
                code[endBlockIndex + 1].indexOf("</" + tagStr) <
                (code[endBlockIndex + 1].indexOf("<" + tagStr) == -1
                    ? code[endBlockIndex + 1].length
                    : code[endBlockIndex + 1].indexOf("<" + tagStr))) {

                // if next code has end tag
                if (this.removeControlText(code[endBlockIndex + 1]).trim().indexOf("</" + tagStr) == 0) {
                    // end tag is at the first in the next code
                    endPos = prevCode.length;
                    startPos = prevCode.lastIndexOf("<");
                    tempStr = prevCode.substring(startPos, endPos);
                    // check there is a class in previous code
                    if (tempStr.includes("class=")) {
                        classStart = prevCode.indexOf("class=", startPos) + 7;
                        code[i - 1] = `${prevCode.substring(0,classStart)}${eClass} ${eClass}Cnt${syncCnt} ${prevCode.substring(classStart)}`;
                        syncCnt++;
                        continue;
                    }
                    // if there is no class in previous code
                    endPos = prevCode.lastIndexOf(">");
                    code[i - 1] = `${prevCode.substring(0,endPos)} class="${eClass} ${eClass}Cnt${syncCnt}" ${prevCode.substring(endPos,prevCode.length)}`;
                    syncCnt++;
                    continue;
                } 
                // end tag is in the middle in the next code, which means there is text before the end tag
                startPos = 0;
                endPos = code[endBlockIndex + 1].indexOf("</");
                code[i - 1] = `${code[i - 1]}<span class="${eClass} ${eClass}Cnt${syncCnt}">`;
                syncCnt++;
                code[endBlockIndex + 1] = `</span>${code[endBlockIndex + 1]}`;
                continue;
            }

            // no tag in the next
            code[i - 1] = `${code[i - 1]}<span class="${eClass} ${eClass}Cnt${syncCnt}">`;
            syncCnt++;
            code[endBlockIndex + 1] = `</span>${code[endBlockIndex + 1]}`;
        // previous code is ended with tag -- end
            

        }
        return { type: type, code: code, syncCnt };
    }

    getTitle(currentHTML) {
        const headRegexp = /<head>[\s\S]*?<\/head>/g;
        const titleRegexp = /<title>[\s\S]*?<\/title>/g;
        const headHTML = currentHTML.match(headRegexp) == null ? "" : currentHTML.match(headRegexp)[0];
        const titleCode = headHTML.match(titleRegexp) == null ? "" : headHTML.match(titleRegexp)[0].replace("<title>", "").replace("</title>", "").trim();
        this.titleCode = titleCode.length > 0 ? titleCode : this.titleCode;
    }

    changeTitle(templateTitle) {
        const regexText = `${this.openDelimiter}[^%][\\s\\S]*?${this.closeDelimiter}`;
        const templateRegex = new RegExp(regexText, "g");
        let titleCode = null;
        let titleResult = "";
        let flag = false;
        // interpret template of title
        if (templateTitle.trim().match(templateRegex) != null) {
            titleCode = templateTitle
                .trim()
                .match(templateRegex)[0]
                .replaceAll(`${this.openDelimiter}`, "")
                .replaceAll(`${this.closeDelimiter}`, "");
            flag = true;
        } else {
            titleResult = templateTitle;
        }

        if (flag) titleResult = this.basicCode(titleCode);
        if (document.querySelector("title")) document.querySelector("title").innerHTML = titleResult;
    }

    readMeta(currentHTML) {
        const doc = document.createElement('document');
        doc.insertAdjacentHTML('beforeend', currentHTML);
        const metaTags = doc.querySelectorAll('meta');
        let metaArr = [];
        metaTags.forEach((metaTag, i) => {
            for(let j=0; j<metaTag.attributes.length; j++) {
                if (metaTag.attributes[j].value.indexOf(this.openDelimiter)>-1) {
                    metaArr.push({
                        metaNo: i,
                        attributeNo: j,
                        nodeName: metaTag.attributes[j].name,
                        nodeValue: metaTag.attributes[j].value
                    });
                }
            }
        });
        this.metaArray = JSON.parse(JSON.stringify(metaArr));
        return;
    }

    changeMeta() {
        if (this.metaArray.length==0) return;
        const regexText = `(${this.openDelimiter}[^%][\\s\\S]*?${this.closeDelimiter})`;
        const templateRegex = new RegExp(regexText, "g");
        let metaEls = document.querySelectorAll('meta');
        this.metaArray.forEach(meta => {
            let tempArr = meta.nodeValue.split(templateRegex);
            let isTemplateIn = false;
            for(let j=0; j<tempArr.length; j++) {
                if (tempArr[j].indexOf(this.openDelimiter)==-1) continue;
                let tempStr = tempArr[j].replace(this.openDelimiter, '').replace(this.closeDelimiter, '').trim();
                let tempResult = this.basicCode(tempStr.substring(1));
                tempArr[j] = tempResult;
                isTemplateIn = true;
            }
            if (isTemplateIn) metaEls[meta.metaNo].attributes[meta.attributeNo].nodeValue = tempArr.join('');
        });
    }

    removeComment(html) {
        const commentRegex = /<!--[\s\S]*?-->/gm;
        return html.replace(commentRegex, '');
    }

    async changeCss(newHTML) {
        // remove comment
        newHTML = this.removeComment(newHTML);
        // combine css in style tag and linked css
        let combinedStyle = await this.combineCss(newHTML);
        // seperate style text to template and others
        let { types, codes} = this.seperateCode(combinedStyle, "second");
        this.cssCode = codes;
        this.cssType = types;
        // interpret templates
        let cssBlock = this.interpret(types, codes);
        combinedStyle = cssBlock.join("");
        // parse css string
        let cssRules = this.parseCSS(combinedStyle);
        this.cssRules = cssRules;
        const modifiedCss = this.createTextStyle(cssRules);
        if (modifiedCss == "") return;
        // remove all style tags
        document.querySelectorAll("style").forEach((style) => {
            style.parentNode.removeChild(style);
        });
        // create and append all combined CSS
        let t_style = document.createElement("style");
        t_style.appendChild(document.createTextNode(modifiedCss));
        document.head.appendChild(t_style);
        // remove CSS link except linked CSS from other server
        document.head.querySelectorAll("link").forEach((element) => {
            if (element.getAttribute("rel") == "stylesheet" && !element.getAttribute("href").includes("http")) {
                element.parentNode.removeChild(element);
            }
        });
    }

    changeCssFromCombinedStyle(combinedStyle) {
        // seperate style text to template and others
        let { types, codes} = this.seperateCode(combinedStyle, "second");
        this.cssCode = codes;
        this.cssType = types;
        // interpret templates
        let cssBlock = this.interpret(types, codes);
        combinedStyle = cssBlock.join("");
        // parse css string
        let cssRules = this.parseCSS(combinedStyle);
        this.cssRules = cssRules;
        const modifiedCss = this.createTextStyle(cssRules);
        if (modifiedCss == "") return;
        // remove all style tags
        document.querySelectorAll("style").forEach((style) => {
            style.parentNode.removeChild(style);
        });
        // create and append all combined CSS
        let t_style = document.createElement("style");
        t_style.appendChild(document.createTextNode(modifiedCss));
        document.head.appendChild(t_style);
        // remove CSS link except linked CSS from other server
        document.head.querySelectorAll("link").forEach((element) => {
            if (element.getAttribute("rel") == "stylesheet" && element.getAttribute("href").indexOf("http")<0) {
                element.parentNode.removeChild(element);
            }
        });
    }    

    async combineCss(newHTML) {
        // declare variables
        const linkregexp = /<link.*?rel="stylesheet"[\s\S]*?\/?>/gi;
        const styleregexp = /<style>[\s\S]*?<\/style>/gi;
        const getHref = (str) => str.match(/href=".*?"/gi)[0].replaceAll("href=", "").replaceAll('"', "");
        let urls = [];
        let styleBlock = [];

        // if there is no head tag to parse
        let startPos = newHTML.indexOf("<head>");
        let endPos = newHTML.indexOf("</head>");
        if (startPos == -1 || endPos == -1) return ""; // if there is no head tag to parse

        // get CSS in style tag
        newHTML.replace(styleregexp, function (match) {
            styleBlock.push(match.replaceAll("<style>", "").replaceAll("</style>", ""));
            return "";
        });
        let combinedStyle = styleBlock.join("");
        // get urls of linked css files
        let linkTags = [];
        newHTML.replace(linkregexp, function (match) {
            linkTags.push(match);
            return "";
        });
        let relUrl = this.currentUrl().host;
        linkTags.forEach((linkTag) => {
            let linkHref = getHref(linkTag);
            if (linkHref.indexOf("http")<0 && linkHref.indexOf("base64,"<0)) urls.push(new URL(linkHref, relUrl).href);
        });
        urls = urls.map(url => this.removeControlText(url));
        // read and combine css files
        let importedStyles = await this.getTextFromFiles(urls);

        let relativeUrls = [];
        urls.forEach(url => {
            relativeUrls.push(this.getComparedPath(url, this.currentUrl().host));
        });

        for (let i=0; i<importedStyles.length; i++) {
            importedStyles[i] = this.replaceRelativeUrl(importedStyles[i], relativeUrls[i]);
        }

        combinedStyle = importedStyles.join('');
        combinedStyle = await this.insertNestedCSS(combinedStyle);
        return combinedStyle;
    }
    getOnlyPath(url) {
        let arr = url.split('/');
        arr.pop();
        return arr.join('/');
    }
    splitUrl(url) {
        let arr = url.split('/');
        if (arr[arr.length-1]=='') arr.pop();
        if (arr[0]=='') arr.shift();
        return arr;
    }
    getRelativeUrl(url) {
        let host = this.currentUrl().host;
        let arrUrl = this.splitUrl(url);
        let stdUrl = this.splitUrl(host);
        let added = [];
        for (let i=0; i<stdUrl.length; i++) {
            if (stdUrl[i] !== arrUrl[i]) {
                added.push("..");
            } else {
                arrUrl[i] = ".";
            }
        }
        arrUrl = [...added, ...arrUrl];

        for(let i=0; i<arrUrl.length; i++) {
            if (arrUrl[i]=="." && arrUrl[i+1]==".") arrUrl[i]="_erase_";
        }
        for (let i=arrUrl.length-1; i>=0; i--) {
            if (arrUrl[i] == "_erase_") {
                arrUrl.splice(i,1);
            } else if (arrUrl[i]=="." && i>0){
                arrUrl.splice(i,1);
            }
        }
        return "/"+arrUrl.join('/')+"/";
    }
    getComparedPath(url, host) {
        url = this.getOnlyPath(url);
        url = this.getRelativeUrl(url);
        host = this.getRelativeUrl(host);
        let arrUrl = this.splitUrl(url);
        let stdUrl = this.splitUrl(host);
        let added = [];

        for (let i=0; i<stdUrl.length; i++) {
            if (stdUrl[i] !== arrUrl[i]) {
                if (stdUrl[i] !== '') added.push("..");
            } else {
                arrUrl[i] = ".";
            }
        }

        arrUrl = [...added, ...arrUrl];
        return arrUrl.join('/')+"/";
    }
    replaceRelativeUrl(style, relativeUrl) {
        const urlRegex = /(@import *['"])(.*?)(['"])|(url\(['"]?)(.*?)(['"]?\))/g;
        function replacer (match, p1, p2, p3, p4, p5, p6) {
            if (p1 == undefined) {
                p5 = compareUrls(p5, relativeUrl);
                return p4+p5+p6;
            } else {
                p2 = compareUrls(p2, relativeUrl); 
                return p1+p2+p3;
            }
        }
        function compareUrls(oldUrl, baseUrl) {
            if (!oldUrl.includes('/')) return baseUrl+oldUrl;
            if (oldUrl.substring(0,1)=="/") return baseUrl+oldUrl.substring(1);
            if (oldUrl.substring(0,2)=="./") return baseUrl+oldUrl.substring(2);
            if (oldUrl.substring(0,3)=="../") {
                let prevSlashNo = [... oldUrl.matchAll(/\.\.\//g)].length;
                let baseArr = baseUrl.split('/');
                baseArr.pop();
                while (baseArr.length>=0 && prevSlashNo>0) {
                    baseArr.pop();
                    prevSlashNo--;
                }                
                baseUrl = "."+baseArr.join("/")+"/";
                return baseUrl+oldUrl.substring(3);
            }
        }
        if (style.includes('base64,') || style.includes('http')) return style;
        let newStyle = style.replace(urlRegex, replacer);
        return newStyle;
    } 

    htmlReplaceRelativeUrl(html, relativeUrl) {
        const urlRegex = /(\<[a-z]* *src *= *['"`])((?!http|\<\%).*)(['"`])|(href *= *['"`])((?!http|\<\%|#).*[^\>\%])(['"`])|(\<\%[^\%] *include *\(?["'`])(.*)(["'`])/g;
        function replacer (match, p1, p2, p3, p4, p5, p6, p7, p8, p9) {
            if (p1 !== undefined) {
                p2 = compareUrls(p2, relativeUrl);
                return p1+p2+p3;
            } else if (p4 !== undefined) {
                p5 = compareUrls(p5, relativeUrl); 
                return p4+p5+p6;
            } else {
                p8 = compareUrls(p8, relativeUrl);
                return p7+p8+p9;
            }
        }
        function compareUrls(oldUrl, baseUrl) {
            if (!oldUrl.includes('/')) return baseUrl+oldUrl;
            if (oldUrl.substring(0,1)=="/") return baseUrl+oldUrl.substring(1);
            if (oldUrl.substring(0,2)=="./") return baseUrl+oldUrl.substring(2);
            if (oldUrl.substring(0,3)=="../") {
                let prevSlashNo = [... oldUrl.matchAll(/\.\.\//g)].length;
                let baseArr = baseUrl.split('/');
                baseArr.pop();
                while (baseArr.length>=0 && prevSlashNo>0) {
                    baseArr.pop();
                    prevSlashNo--;
                }
                baseUrl = "."+baseArr.join("/")+"/";
                return baseUrl+oldUrl.substring(3);
            }
        }

        let newHtml = html.replace(urlRegex, replacer);
        return newHtml;
    } 

    async insertNestedCSS(styleText) {
        let finalCSS = "";
        // get urls of css to import, where to insert, seperated css array
        let { urls, orders, codes, media } = this.findImport(styleText);
        finalCSS = codes.join("");
        // if there is no @import at all
        if (urls.length == 0) return finalCSS;
        // read nested CSS files
        let insertedCSSs = await this.getTextFromFiles(urls);
        let relativeUrls = [];
        // adjust relative addresses in nested CSS files to an address of integrated style 
        urls.forEach(url => {
            relativeUrls.push(this.getComparedPath(url, this.currentUrl().host));
        })
        for (let i=0; i<insertedCSSs.length; i++) {
            insertedCSSs[i] = this.replaceRelativeUrl(insertedCSSs[i], relativeUrls[i]);
        }
        // insert CSS of files into each places of @import
        insertedCSSs.forEach((insertedCSS, i) => {
            codes[orders[i]] = (media[i] !== "") ? this.insertMedia(insertedCSS, media[i]) : insertedCSS;
        });
        // new CSS with nested CSS
        finalCSS = codes.join("");
        // recursively find further nested CSS
        return await this.insertNestedCSS(finalCSS);
    }

    insertMedia(code, media) {
        return `@media ${media} { ${code} }`;
    }

    findImport(styleText) {
        // declare variables
        let importArray = []; // only @import in CSS
        let urls = []; // url for inclusion
        let media = [];
        let orders = []; // index of @import out of array
        let tempString = "";
        let cnt = 0;
        const importNonCapRegex = /(@import *?(?:url)?\(?["'].*["']\)? *?.*;)/g;
        const importRegex = /@import *?(url)?\(?["'](.*)["']\)? *?(.*);/g;
        const importUrlRegex = /[^(?:\.)|(?:\.\/)].*/g;
        let codes = styleText.split(importNonCapRegex);
        // categorize CSS to @IMPORT and OTHER
        importArray = [...styleText.matchAll(importRegex)];
        // only @import to includeArray
        for (let i = 0; i < codes.length; i++) {
            if (codes[i].search(importNonCapRegex) != -1 && !codes[i].includes("http")) {
                orders[cnt] = i;
                cnt++;
            } else {
                codes[i] = this.removeControlText(codes[i]).trim();
            }
        }
        // if @import exists, get pathname from CSS
        importArray.forEach((script) => {
            tempString = script[2].match(importUrlRegex)[0].trim();
            urls.push(this.currentUrl().host + tempString);
            media.push(script[3] === null ? "" : script[3].trim());
        });
        return {
            urls,
            orders,
            codes,
            media
        };
    }

    createTextStyle(cssRules) {
        // create style text from cssRules object
        let modifiedCss = "";
        let cssRulesLen = cssRules.length;
        for (let i = 0; i < cssRulesLen; i++) {
            let cssRule = cssRules[i];
            let cssType = cssRule.type == undefined ? "" : cssRule.type;
            switch (cssType) {
                case "":
                case "font-face":
                    modifiedCss = modifiedCss + cssRule.selector + " {\n";
                    cssRule.rules.forEach((rule) => {
                        modifiedCss += `    ${rule.key}: ${rule.value};\n`;
                    });
                    modifiedCss += "}\n";
                    break;
                case "imports":
                case "keyframes":
                    modifiedCss += cssRule.styles.replaceAll("{", "{\n").replaceAll("}", "}\n").replaceAll(";", ";\n") + "\n";
                    break;
                case "supports":
                case "media":
                    modifiedCss += cssRule.selector + " {\n";
                    cssRule.subStyles.forEach((subStyle) => {
                        modifiedCss += "    " + subStyle.selector + " {\n";
                        subStyle.rules.forEach((rule) => {
                            modifiedCss += `        ${rule.key}: ${rule.value};\n`;
                        });
                        modifiedCss += "    }\n";
                    });
                    modifiedCss += "}\n";
                    break;
            }
        }
        return modifiedCss;
    }

    // partial render for data object or files
    async renderPart(dataText = "", type = "") {
        let source = "";
        let result = "";
        let path = "";
        let tempCode = [];
        let sync = [];
        let returnValue = "";
        let combinedStyle = "";
        let cssBlock = [];
        let cssRules = [];
        let modifiedCss = "";

        if (type.trim() == "")
            return "select type from html, html_path";
        if (dataText.trim() == "")
            return "nothing to render";

        switch (type) {
            case "HTML":
                source = dataText;
                let { fileIncludedHTML, codeList } = await this.insertNestedHTML(source);
                // insert nested HTML modules
                let moduleIncludedHTML = this.insertModules(fileIncludedHTML);                
                tempCode = this.seperateCode(moduleIncludedHTML, "second");
                sync = this.makeSyncBlock(tempCode.types, tempCode.codes);

                if (tempCode.types[0] == "JS") {
                    tempCode.types.unshift("HTML");
                    tempCode.codes.unshift(" ");
                    sync = sync.map((x) => x + 1);
                    sync.unshift(0);
                }
                tempCode = this.insertSync(tempCode.types, tempCode.codes, sync);
                this.syncCnt = tempCode.syncCnt;
                result = this.interpret(tempCode.type, tempCode.code);
                returnValue = result.join("");
                return {
                    domText: returnValue,
                    sourceType: tempCode.type,
                    sourceCode: tempCode.code,
                    sourceSync: sync,
                };
            case "CSS":
                source = dataText;
                source = await this.insertNestedCSS(source);
                // seperate style text to template and others
                tempCode = this.seperateCode(source, "second");
                // interpret templates
                cssBlock = this.interpret(tempCode.type, tempCode.code);
                combinedStyle = cssBlock.join("");
                // parse css string
                cssRules = this.parseCSS(combinedStyle);
                modifiedCss = this.createTextStyle(cssRules);
                return {
                    cssText: modifiedCss,
                    cssRules: cssRules,
                    cssType: tempCode.type,
                    cssCode: tempCode.code,
                };
        }
    }

    async appendHTML(dataText = "", element) {
        if (dataText=="") return "nothing to append";
        let obj = await this.renderPart(dataText, "HTML");
        let domText = obj.domText || "";
        if (element == undefined) return "no element to append to";
        const tempType = obj.sourceType || [];
        const tempCode = obj.sourceCode || [];
        const tempSync = obj.sourceSync || [];
        if (this.getObjectType(element) != "DOMobject") return "invalid element to append into";
        if (tempType.length == 0) return "nothing to append";
        // adding template information for sync
        this.htmlType = [...this.htmlType, ...tempType];
        this.htmlCode = [...this.htmlCode, ...tempCode];
        this.htmlSync = [...this.htmlSync, ...tempSync];
        // appending interpreted html to element
        domText = domText.trim();
        if (domText == "") return "nothing to append";
        element.insertAdjacentHTML("beforeend", domText);
        return "success";
    }

    async appendCSS(dataText = "") {
        if (dataText == "") return;
        let cssObject = await this.renderPart(dataText, "CSS");
        let modifiedCss = cssObject.cssText || "";
        let cssRules = cssObject.cssRules || [];
        let cssType = cssObject.cssType || [];
        let cssCode = cssObject.cssCode || [];
        let styleElement;
        if (document.querySelector("style") == null) {
            styleElement = document.createElement("style");
            styleElement.appendChild(document.createTextNode(modifiedCss));
            document.head.appendChild(styleElement);
            this.cssRules = [...this.cssRules, ...cssRules];
            this.cssType = [...this.cssType, ...cssType];
            this.cssCode = [...this.cssCode, ...cssCode];
            return "success";
        }
        styleElement = document.createTextNode(modifiedCss);
        document.querySelector("style").appendChild(styleElement);
        this.cssRules = [...this.cssRules, ...cssRules];
        this.cssType = [...this.cssType, ...cssType];
        this.cssCode = [...this.cssCode, ...cssCode];
        return "success";
    }

    basicCode(script) {
        try {
            return Function(`"use strict"; return ( ${script.substring(1)} )`)();
        } catch (e) {
            console.log(script);
            console.error(e);
            return `invalid template`;
        }
    }

    controlCode(script) {
        script = this.removeControlText(script);
        try {
            return Function(`"use strict"; ${script.replace(/[\n\r\t]/g, "")}`)();
        } catch (e) {
            console.error(e);
            return `invalid template block`;
        }
    }

    currentUrl() {
        let fullUrl = window.location.href;
        let urlHash = window.location.hash;
        fullUrl = fullUrl.replace(urlHash, "");
        let fileName = fullUrl.split("/").pop();
        let host = fullUrl.substring(0, fullUrl.length - fileName.length); // host + path (without filename)
        if (urlHash != "")
            fileName = urlHash.substring(1) + ".html";
        return { host: host, filename: fileName };
    }

    async getTextFromFiles(urls) {
        if (urls.length == 0) return [];
        let requests = urls.map((url) => fetch(url));
        let responses = await Promise.allSettled(requests);
        let errorNo = [];
        responses.map((res, i) => {
            if (!res.value.ok) errorNo.push(i);
        });
        responses = responses.filter((res) => res.value.ok);
        let successfulResponses = responses.map((res) => res.value);
        responses = await Promise.all(successfulResponses);
        let responseTexts = responses.map((res) => res.text());
        let insertedTexts = await Promise.all(responseTexts);
        errorNo.map((err) => insertedTexts.splice(err, 0, "error: check your path of include"));
        return insertedTexts;
    }

    removeAllChildNodes(parent) {
        while (parent.firstChild) {
            parent.removeChild(parent.firstChild);
        }
    }

    parseCSS(cssText) {
        if (cssText === undefined)
            return [];
        let commentRegex = /\/\*.*?\*\//g;
        let importsRegex = /@import .*?\(.*?\);/g;
        let keyframesRegex = /((@keyframes[\s\S]*?){([\s\S]*?}\s*?)})/g;
        let generalRegex = /((\s*?(?:\/\*[\s\S]*?\*\/)?\s*?(@media|@supports)[\s\S]*?){([\s\S]*?)}\s*?})|(([\s\S]*?){([\s\S]*?)})/g;
        let css = [];
        // remove comments
        cssText = cssText.replace(commentRegex, "");
        //get import
        let imports = [...cssText.matchAll(importsRegex)];
        let importsLen = imports.length;
        for (let i = 0; i < importsLen; i++) {
            let imported = imports[i];
            css.push({
                selector: "@imports",
                type: "imports",
                styles: imported[0],
            });
        }
        cssText = cssText.replace(importsRegex, "");
        // get keyframes
        let keyframes = [...cssText.matchAll(keyframesRegex)];
        let keyframesLen = keyframes.length;
        for (let i = 0; i < keyframesLen; i++) {
            let keyframe = keyframes[i];
            css.push({
                selector: "@keyframes",
                type: "keyframes",
                styles: keyframe[0],
            });
        }
        cssText = cssText.replace(keyframesRegex, "");
        // get general rules
        let generalRules = [...cssText.matchAll(generalRegex)];
        let genLen = generalRules.length;
        for (let i = 0; i < genLen; i++) {
            let generalRule = generalRules[i];
            let selector = generalRule[2] === undefined ? generalRule[6] : generalRule[2];
            selector = this.standardReturn(selector);
            let type = selector.includes("@media")
                ? "media"
                : selector.includes("@supports")
                    ? "supports"
                    : selector === "@font-face"
                        ? "font-face"
                        : "";
            let cssObject = { selector: selector, type: type };
            if (type === "media" || type === "supports") {
                // recursive call of parseCss for subStyles
                cssObject.subStyles = this.parseCSS(generalRule[4] + "\n}");
            } else {
                // parse rules for general rules insde @media and @supports
                cssObject.rules = this.parseRules(generalRule[7]);
            }
            css.push(cssObject);
        }
        return css;
    }

    parseRules(rules) {
        let parsedArr = [];
        rules = this.standardReturn(rules).split(";");
        let rulesLength = rules.length;
        for (let i = 0; i < rulesLength; i++) {
            let rule = rules[i];
            rule = rule.trim();
            if (!rule.includes(":") && rule.trim().substring(0, 7) === "base64,") {
                parsedArr[parsedArr.length - 1].value += rule.trim();
                continue;
            }
            if (rule.includes(":")) {
                rule = rule.split(":");
                let cssKey = rule[0].trim();
                let cssValue = rule.slice(1).join(":").trim();
                if (cssKey.length > 0 && cssValue.length > 0)
                    parsedArr.push({ key: cssKey, value: cssValue });
            }
        }
        return parsedArr;
    }

    standardReturn(str) {
        return str.split("\r\n").join("\n").replace(/\n+/, "\n").trim();
    }

    arrayFind(arr1, arr2) {
        let hash = {};
        let arrLen = arr1.length;
        for (let i = 0; i < arrLen; i++) {
            hash[arr1[i]] = i;
        }
        if (hash.hasOwnProperty(arr2))
            return hash[arr2];
        return -1;
    }

    escapeHtml(str) {
        let map = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;",
            "(": "&#40;",
            ")": "&#41;",
        };
        return str.replace(/[&<>"'()]/g, function (m) {
            return map[m];
        });
    }

    removeControlText(str) {
        return str.replaceAll(/\r|\n|\t/g, "");
    }

    verifyFilename(filename) {
        if (filename.trim().length == 0) return "";
        return new URL(filename, this.currentUrl().host).href.replaceAll(this.currentUrl().host, "");
    }

    // check object type for renderPart()
    getObjectType(o) {
        if (typeof HTMLElement === "object"
            ? o instanceof HTMLElement
            : o && typeof o === "object" && o !== null && o.nodeType === 1 && typeof o.nodeName === "string") {
            return "DOMobject";
        } else {
            return o.includes(this.openDelimiter) && o.includes(this.closeDelimiter)
                ? "template"
                : o.includes(".html")
                    ? "html_path"
                    : o.includes(".css")
                        ? "css_path"
                        : "undefined";
        }
    }

}
// mouse is on inside or outside of document
document.onmouseover = function () {
    window.innerDocClick = true;
};
document.onmouseleave = function () {
    window.innerDocClick = false;
};