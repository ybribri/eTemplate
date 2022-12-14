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
 * ! ver 2.40 : add function of nesting CSS patterns
 * Render and sync state changes of variable to HTML and CSS using template literals 
 * @class
 * @param {string} openDelimiter start tag of template
 * @param {string} closeDelimiter end tag of template
 * @param {string} syncClass class name to update
 * @param {string} startUrl if syncUrl is not defined for render(), startUrl can be loaded.
 * @param {object} urlList array of urls to use single page app
 * @param {boolean} useHash whether to use hashes in url for single page app
 */
class eTemplate {
    constructor( 
        {
            openDelimiter = "<%",
            closeDelimiter = "%>",
            syncClass = "et_sync",
            startUrl = "",
            urlList = [],
            useHash = true,
            titleChange = true,
            metaChange = true,
            cssChange = true
        } = {}
    ) {
        this.startUrl = startUrl; // default url replacing index.html
        this.syncClass = syncClass; // class name to update
        this.openDelimiter = openDelimiter; // start tag of template
        this.closeDelimiter = closeDelimiter; // end tag of template
        this.commentDelimiter = openDelimiter + "%"; // start tag of comment template
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
        this.urlList = urlList; // urls to read in advance while the first page is being loaded
        this.preRead = []; // stored and integrated codes from web workers         
        this.scripts = []; // temporarily stored scripts
        // to store options throughout the class
        this.options = { 
            useHash : useHash,
            titleChange : titleChange,
            metaChange : metaChange,
            cssChange : cssChange
        }; 
    }

    /**
     * !Interpret CSS and HTML with templates and Render them
     * @param {string} url filename to render in <body>
     * @param {object} scroll object for scroll after rendering
     * @param {string} scroll.id ID of elements to scroll to
     * @param {string} scroll.position position of elements with ID to scroll
          */

    async render({ url = "", scroll = {} } = {}, callback = ()=>{} ) {
        if (typeof arguments[0]==='function') callback = arguments[0];
        const hash = window.location.hash.substring(1);
        if (this.options.useHash) {
            url = url !== "" ? url : hash!==''? hash+'.html': this.startUrl !== "" ? this.startUrl : this.currentUrl().filename;
        } else {
            url = url !== "" ? url : this.startUrl !== "" ? this.startUrl : this.currentUrl().filename;
        }
        
        // adjust relative pathname to match host url
        url = this.verifyFilename(url);
        // store urlList
        this.urlList = this.urlList.map(list => this.verifyFilename(list));
        // added workers
        const INDEX = this.urlList.indexOf(url) || 0;
        let joinedHTML = '';
        this.syncCnt = 0;

        if (this.preRead.length == 0) {     
            // if it's the first time to render, preRead() unless ther is no urlList
            let transferOptions = this.options;
            transferOptions.openDelimiter = this.openDelimiter;
            transferOptions.closeDelimiter = this.closeDelimiter;
            if (this.urlList.length > 0) this.preReadFiles(this.urlList, transferOptions );
            const ABSOLUTE_URL = this.currentUrl().host + url;        
            //  read first layer HTML
            const RESPONSE = await fetch(ABSOLUTE_URL);
            const CURRENTHTML = await RESPONSE.text();
            // read META
            if (this.options.metaChange) {
                this.readMeta(CURRENTHTML);
                this.changeMeta();
            }
            // change title
            if (this.options.titleChange) {
                this.getTitle(CURRENTHTML);        
                this.changeTitle(this.titleCode);
            }
            // read multiple layers and proceed
            const RESULT = await this.readFurther(CURRENTHTML);
            // add scripts to interpreted htmlBlock
            joinedHTML = RESULT.htmlBlock.join('') + this.scripts.join('');
            // variables for sync()
            this.htmlCode = RESULT.OBJ_CODE.code;
            this.htmlType = RESULT.OBJ_CODE.type;        
        } else {        // already has pre-read pages
            const HTML_WITH_NESTED_FILES = this.preRead[INDEX].fileIncludedHTML;
            const STYLE_TEXT = this.preRead[INDEX].cssText;
            this.titleCode = this.preRead[INDEX].titleCode;
            this.metaArray = this.preRead[INDEX].metaArray;
            this.templateInClass = [];
            this.syncCnt = 0;
            // change meta
            if (this.options.metaChange) this.changeMeta();
            // change title
            if (this.options.titleChange) this.changeTitle(this.titleCode);
            // chanes CSS
            if (this.options.cssChange) this.changeCssFromCombinedStyle(STYLE_TEXT);
            // insert nested HTML modules
            const HTML_WITH_MODULES = this.insertModules(HTML_WITH_NESTED_FILES);
            const RESULT = await this.readFurtherFromCombinedHTML(HTML_WITH_MODULES);
            joinedHTML = RESULT.htmlBlock.join('');
            this.htmlCode = RESULT.OBJ_CODE.code;
            this.htmlType = RESULT.OBJ_CODE.type;    
        }

        // remove current content of body and insert new content
        this.removeAllChildNodes(document.querySelector("body"));
        document.body.insertAdjacentHTML("afterbegin", joinedHTML);

        if (scroll != {} && Object.keys(scroll).length != 0) {
            const targetElement = document.getElementById(scroll.id);
            const blockArr = ["start", "center", "end"];
            const isInBlock = blockArr.some((el) => el == scroll.position);
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
     * @returns nothing
     */
    async preReadFiles(urlList, options) {
        let workers = [];
        for(let i=0; i<urlList.length; i++) {
            const path = new URL(urlList[i], this.currentUrl().host).href;
            workers[i] = (new Worker(this.currentUrl().host + 'js/worker.min.js'));
            workers[i].postMessage({path, options});
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
     * @param {string} currentHTML html string to check scripts
     * @returns {string} script removed HTML text
     */
    storeScript(currentHTML) {
        const BODY_REGEX = /<body*?>(\n|\r|\t|.)*/gm;
        const SCRIPT_REGEX = /<script[\s\S]*?>[\s\S]*?<\/script>/gm;
        const HTML_BODY = currentHTML.match(BODY_REGEX);
        if (HTML_BODY === null) return currentHTML;
        const scripts = HTML_BODY[0].match(SCRIPT_REGEX, "");
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
     * @returns {object} htmlBlock: interpreted codes array / codeList: object of code and type
     */
    async readFurther(currentHTML) {
        // remove comments
        currentHTML = this.removeComment(currentHTML);
        // remove scripts in body
        currentHTML = this.storeScript(currentHTML);
        // CSS change in HEAD
        if (this.options.cssChange) await this.changeCss(currentHTML); 
        // insert nested HTML files
        const { fileIncludedHTML } = await this.insertNestedHTML(currentHTML);
        // insert nested HTML modules
        const HTML_WITH_MODULES = this.insertModules(fileIncludedHTML);
        // categorize codes
        let { types, codes } = this.seperateCode(HTML_WITH_MODULES, "second");
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
        const OBJ_CODE = this.insertSync(types, codes, sync);
        this.htmlSync = sync;
        this.syncCnt = OBJ_CODE.syncCnt;
        // interprete template scripts
        const htmlBlock = this.interpret(types, codes);
        return new Promise((resolve, reject) => {
            resolve({ htmlBlock, OBJ_CODE });
        });
    }

    /**
     * read further from stored HTML and process
     * @method
     * @async
     * @param {string} currentHTML source HTML text which was loaded firstly (not interpreted yet)
     * @returns {object} htmlBlock: interpreted codes array / codeList: object of code and type
     */
    async readFurtherFromCombinedHTML(HTML_WITH_NESTED_FILES) {
        // insert nested HTML modules
        const HTML_WITH_MODULES = this.insertModules(HTML_WITH_NESTED_FILES);
        // categorize codes
        let { types, codes } = this.seperateCode(HTML_WITH_MODULES, "second");
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
        const OBJ_CODE = this.insertSync(types, codes, sync);
        this.htmlSync = sync;
        this.syncCnt = OBJ_CODE.syncCnt;
        // interprete template scripts
        const htmlBlock = this.interpret(types, codes);
        return { htmlBlock, OBJ_CODE };
    }

    /**
     * updates applied templates both on HTML and CSS if there are variable changes.
     * @returns nothing
     */
    sync() {
        // let temp = "";
        const eClass = this.syncClass;
        // check and change meta info
        if (this.options.metaChange) this.changeMeta();
        // check and change title
        if (this.options.titleChange) this.changeTitle(this.titleCode);
        // change related variables from input values
        const inputEls = document.querySelectorAll(`input.${eClass}`);
        for (let i = 0; i < inputEls.length; i++) {
            const inputEl = inputEls[i];
            let temp = inputEl.getAttribute("data-sync");
            if (temp == null) continue;
            let isQuote = (inputEl.type=="number") ? '' : '"';
            temp += "=" + (inputEl.value ? `${isQuote}${this.escapeHtml(inputEl.value)}${isQuote};` : '"";');
            try { this.controlCode(temp); } 
            catch (error) { return error; }
        }

        // interprete registered templates
        let htmlBlock = this.interpretPart(this.htmlType, this.htmlCode);

        // change current template to newly interpreted templates
        const eClassEls = document.querySelectorAll(`.${eClass}`);
        for (let i = 0; i < eClassEls.length; i++) {
            let eClassEl = eClassEls[i];
            const classLists = [...eClassEl.classList];

            // get attribute to change from class and index of sync count
            const classes = classLists.find(el => el.startsWith(eClass+'_'));
            const IS_TEMPLATE_IN_ATTRIBUTE = (classes !== undefined) ? true : false;
            const CLASS_CNT = classLists.find(el => el.startsWith(eClass+'Cnt'));
            const INDEX = (CLASS_CNT !== undefined) ? parseInt(CLASS_CNT.replace(`${eClass}Cnt`, ""), 10) : 0;

            if (!IS_TEMPLATE_IN_ATTRIBUTE) {
                if (eClassEl.innerHTML == htmlBlock[INDEX]) continue;
                this.removeAllChildNodes(eClassEl);
                eClassEl.insertAdjacentHTML("afterbegin", htmlBlock[INDEX]);
                continue;                
            }

            for (let j = 0; j < htmlBlock[INDEX].length; j++) {
                let temp = '';
                // if didn't change, continue
                if (this.templateInClass[INDEX][j][1] == htmlBlock[INDEX][j]) continue;
                // attribute: class
                if (this.templateInClass[INDEX][j][0] == "class") {
                    eClassEl.classList.remove(this.templateInClass[INDEX][j][1]);
                    eClassEl.classList.add(htmlBlock[INDEX][j]);
                    this.templateInClass[INDEX][j][1] = htmlBlock[INDEX][j];
                // attribute: data
                } else if (this.templateInClass[INDEX][j][0].includes('data-')){
                    const datasetName = this.templateInClass[INDEX][j][0].substring(this.templateInClass[INDEX][j][0].INDEXOf('data-')+5);
                    temp = eClassEl.dataset[datasetName];
                    temp = temp.replace(this.templateInClass[INDEX][j][1], htmlBlock[INDEX][j]);
                    eClassEl.dataset[datasetName] = temp;
                    this.templateInClass[INDEX][j][1] = htmlBlock[INDEX][j];
                // attribute: others
                } else {
                    temp = eClassEl.getAttribute(this.templateInClass[INDEX][j][0]);
                    temp = temp.replace(this.templateInClass[INDEX][j][1], htmlBlock[INDEX][j]);
                    eClassEl.setAttribute(this.templateInClass[INDEX][j][0], temp);
                    this.templateInClass[INDEX][j][1] = htmlBlock[INDEX][j];
                }
            }
        }
        if (this.options.cssChange) this.syncCss();
    }

    /**
     * update templates in CSS that changed there are changes in variables 
     * @returns nothing
     */
    syncCss() {
        // if there is no template in CSS, go back
        if (this.cssType.length == 0 || !this.cssType.includes("JS")) return;
        // interpret seperated CSS and parse it to CSS rules
        const htmlBlock = this.interpret(this.cssType, this.cssCode);
        const cssRules = this.parseCSS(htmlBlock.join("")); // new rules of CSS
        // find combined style tag
        let sheetNo = 0;
        for (let i = 0; i < document.styleSheets.length; i++) {
            if (document.styleSheets[i].href == null) {
                sheetNo = i;
                break;
            }
        }
        const EMPTY_REGEX = /\s+|\\n/g;
        const oRules = this.cssRules; // old rules 
        const oRulesLen = oRules.length;
        let modifiedCss = "";
        let toAdd = []; // temporarily stores rules to add
        let updatedRules = []; // temporarily stores rules to update
        const cssRulesLen = cssRules.length; 
        // check and update CSS change
        for (let i = 0; i < cssRulesLen; i++) {
            const cssRule = cssRules[i];
            const cssType = cssRule.type == undefined ? "" : cssRule.type;
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
                    if (oldText.replace(EMPTY_REGEX, "") != newText.replace(EMPTY_REGEX, "")) {
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
                            const key = oRules[currentIndex].subStyles[currentSubIndex].rules[currentStyle].key;
                            const oldValue = oRules[currentIndex].subStyles[currentSubIndex].rules[currentStyle].value;
                            const newValue = rule.value;
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
                    const cssRuleRulesLen = cssRule.rules.length;
                    for (let ci = i; ci < oRulesLen; ci++) {
                        const oRule = oRules[ci];
                        if (cssRule.selector == oRule.selector) {
                            currentIndex = ci;
                            break;
                        }
                    }
                    if (currentIndex == -1) {
                        modifiedCss = cssRule.selector + " {\n";
                        for (let j = 0; j < cssRuleRulesLen; j++) {
                            modifiedCss += `    ${cssRule.rules[j].key}: ${cssRule.rules[j].value};\n`;
                        }
                        modifiedCss += "}\n";
                        toAdd.push(["rule", i, -1, -1, modifiedCss]);
                        break;
                    }
                    for (let j = 0; j < cssRuleRulesLen; j++) {
                        const rule = cssRule.rules[j];
                        let currentStyle = -1;
                        const oRulesRulesLen = oRules[currentIndex].rules.length;
                        for (let cj = 0; cj < oRulesRulesLen; cj++) {
                            const oldKey = oRules[currentIndex].rules[cj].key;
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
                        const key = oRules[currentIndex].rules[currentStyle].key;
                        const oldValue = oRules[currentIndex].rules[currentStyle].value;
                        const newValue = rule.value;
                        if (oldValue != newValue) document.styleSheets[sheetNo].cssRules[currentIndex].style.setProperty(key, newValue);
                        updatedRules.push([currentIndex, -1, currentStyle, typeNo]);
                    }
                    break;
            }
        }

        // delete rules
        const cssLength = oRules.length;
        let ruleLength = 0;
        let styleLength = 0;
        for (let i = cssLength - 1; i >= 0; i--) {
            let typeNo = 0;
            const oRule = oRules[i];
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
                    const isUpdated = this.arrayFind(updatedRules, [i, -2, 0, 7]);
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

        const currentBodyHTML = currentHTML.match(bodyRegexp) === null ? currentHTML : currentHTML.match(bodyRegexp)[0].replace(bodyStartRegexp, "").replace(bodyEndRegexp, "");
        let { codes, types } = this.seperateCode(currentBodyHTML, "first");

        const typeLen =types.length;
        const hostUrl = this.currentUrl().host;
        for (let i = 0; i < typeLen; i++) {
            if (types[i] == "JS" && includeRegexp.test(codes[i])) {
                const tempString = codes[i].match(includeRegexp)[0].replace(includeStartRegexp, '').replace(includeEndRegexp, '');
                urls.push(new URL(tempString, hostUrl).href);
                orders.push(i);
            }
        }

        return {
            urls,
            orders,
            codes,
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
        let { urls, orders, codes } = this.findInclude(currentHTML, basePath);
        if (urls.length == 0) {
            fileIncludedHTML = this.removeComment(codes.join(""));
            return { fileIncludedHTML, codes };
        }
        let relativeUrls = [];
        urls.forEach(url => relativeUrls .push(this.getComparedPath(url, this.currentUrl().host)));
        let insertedHTMLs = await this.getTextFromFiles(urls);
        for (let i=0; i<insertedHTMLs.length; i++) {
            insertedHTMLs[i] = this.htmlReplaceRelativeUrl(insertedHTMLs[i], relativeUrls[i]);
        }
        // insert HTML of files into the places of each include() scripts.
        insertedHTMLs.forEach((insertedHTML, i) => codes[orders[i]] = insertedHTML);
        fileIncludedHTML = this.removeComment(codes.join(""));
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
        const typeLen = types.length;
        for (let i = 0; i < typeLen; i++) {
            // check whether a code has a module
            if (types[i] == "JS" && codes[i].includes("<%#")) {
                const tempString = ' '+codes[i].match(moduleRegexp)[0].replace(moduleStartRegexp,'').replace(moduleEndRegexp,'');
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
        // recursive call for multi-layer modules if there is still modeuls
        if (cnt !== 0) result = this.insertModules(result);
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
        const codesLen = codes.length;
        for (let i = 0; i < codesLen; i++) {
            const code = codes[i];
            const codeType = templateRegex.test(code) ? "JS" : "HTML";
            codes[i] = codeType === "JS" ? calltype === "second" ? code.substring(2, code.length - 2).trim() : code : code;
            types.push(codeType);
        }
        // combine adjcent HTML
        const typeLength = types.length;
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
        const escapedOpenComment = this.escapeHtml(this.commentDelimiter.replace(this.commentDelimiter, this.openDelimiter));
        const escapedCloseComment = this.escapeHtml(this.closeDelimiter);
        const codeLen = code.length;
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
            const code = codes[i];
            const type = types[i];
            const currentSync = this.htmlSync[i];
            if (currentSync != lastSync && type=="JS") {
                cnt++;
                lastSync = currentSync;
            }
            if (type=="HTML") continue;
            const isBasic = (code.search(/=|-/g) == 0);
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
            const block_data = this.eachBlock(types, codes, i);
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
        const codeLen = code.length;

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
        const codeLen = code.length;
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
        const syncLen = sync.length;
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
            const cleanPrevCode = this.removeControlText(prevCode);
            const endBlank = cleanPrevCode.length - cleanPrevCode.trimEnd().length;
            const lastLetter = cleanPrevCode.substring(cleanPrevCode.length - endBlank - 1).trim();

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

                    const attrText = [... new Set(attrList)].join("+");
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
        let titleResult = templateTitle;
        // interpret template of title
        if (templateTitle.trim().match(templateRegex) != null) {
            titleCode = templateTitle
                .trim()
                .match(templateRegex)[0]
                .replaceAll(`${this.openDelimiter}`, "")
                .replaceAll(`${this.closeDelimiter}`, "");
            titleResult = this.basicCode(titleCode);
        } 
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
        combinedStyle = this.changeNestingPattern(combinedStyle);
        this.changeCssFromCombinedStyle(combinedStyle);
    }

    changeCssFromCombinedStyle(combinedStyle) {
        // seperate style text to template and others
        const { types, codes} = this.seperateCode(combinedStyle, "second");
        this.cssCode = codes;
        this.cssType = types;
        // interpret templates
        const cssBlock = this.interpret(types, codes);
        combinedStyle = cssBlock.join("");
        // parse css string
        const cssRules = this.parseCSS(combinedStyle);
        this.cssRules = cssRules;
        const modifiedCss = this.createTextStyle(cssRules);
        if (modifiedCss == "") return;
        // remove all style tags
        document.querySelectorAll("style").forEach(style => style.parentNode.removeChild(style));
        // create and append all combined CSS
        const t_style = document.createElement("style");
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
        const startPos = newHTML.indexOf("<head>");
        const endPos = newHTML.indexOf("</head>");
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
        const relUrl = this.currentUrl().host;
        linkTags.forEach((linkTag) => {
            const linkHref = getHref(linkTag);
            if (linkHref.indexOf("http")<0) urls.push(new URL(linkHref, relUrl).href);
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

        combinedStyle = combinedStyle + importedStyles.join('');
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
        const host = this.currentUrl().host;
        const stdUrl = this.splitUrl(host);
        let arrUrl = this.splitUrl(url);
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
        const urlRegex = /(@import *['"])(.*?)(['"])|(@import *url\(['"]?)(.*?)(['"]?\))/g;
        function replacer (match, p1, p2, p3, p4, p5, p6) {
            if (p1 == undefined) {
                p5 = this.compareUrls(p5, relativeUrl);
                return p4+p5+p6;
            } else {
                p2 = this.compareUrls(p2, relativeUrl); 
                return p1+p2+p3;
            }
        }
        replacer = replacer.bind(this);
        if (style.includes('base64,') || style.includes('http')) return style;
        let newStyle = style.replace(urlRegex, replacer);
        return newStyle;
    } 

    htmlReplaceRelativeUrl(html, relativeUrl) {
        const urlRegexText = `(\\<[a-z]* *src *= *['"])((?!http|${this.openDelimiter}).*)(['"])|(href *= *['"])((?!http|${this.openDelimiter}|#).*[^\\>\\%])(['"])|(${this.openDelimiter}[^\\%] *include *\\(?["'])(.*)(["'])`;
        const urlRegex = new RegExp(urlRegexText, "g");
        function replacer (match, p1, p2, p3, p4, p5, p6, p7, p8, p9) {
            if (p1 !== undefined) {
                p2 = this.compareUrls(p2, relativeUrl);
                return p1+p2+p3;
            } else if (p4 !== undefined) {
                p5 = this.compareUrls(p5, relativeUrl); 
                return p4+p5+p6;
            } else {
                p8 = this.compareUrls(p8, relativeUrl);
                return p7+p8+p9;
            }
        }
        replacer = replacer.bind(this);
        let newHtml = html.replace(urlRegex, replacer);
        return newHtml;
    }

    compareUrls(oldUrl, baseUrl) {
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

    async insertNestedCSS(styleText) {
        // get urls of css to import, where to insert, seperated css array
        let { urls, orders, codes, media } = this.findImport(styleText);
        // if there is no @import at all
        if (urls.length == 0) return codes.join("");
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
        // recursively find further nested CSS
        return await this.insertNestedCSS(codes.join(""));
    }

    insertMedia(code, media) {
        return `@media ${media} { ${code} }`;
    }

    findImport(styleText) {
        // declare variables
        const importNonCapRegex = /(@import *?(?:url)?\(?["'].*["']\)? *?.*;)/g;
        const importRegex = /@import *?(url)?\(?["'](.*)["']\)? *?(.*);/g;
        const importUrlRegex = /[^(?:\.)|(?:\.\/)].*/g;
        let urls = []; // url for inclusion
        let media = [];
        let orders = []; // index of @import out of array
        let cnt = 0;
        let codes = styleText.split(importNonCapRegex);
        // categorize CSS to @IMPORT and OTHER
        let importArray = [...styleText.matchAll(importRegex)];
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
            const tempString = script[2].match(importUrlRegex)[0].trim();
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
        const cssRulesLen = cssRules.length;
        for (let i = 0; i < cssRulesLen; i++) {
            const cssRule = cssRules[i];
            const cssType = cssRule.type == undefined ? "" : cssRule.type;
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

    changeNestingPattern(styleText) {
        let styleArr = this.getStyle(styleText);
        styleArr = this.getSub(styleArr);
        return this.makeStyle(styleArr);
    }
    
    makeStyle(styleArr) {
        let styleText = '';
        for (let i=0; i<styleArr.length; i++) {
            styleText += `${styleArr[i].selector} {\n ${styleArr[i].styleText}\n}\n`;
        }
        return styleText;
    }
    
    getSub(styleArr) {
        let flag = false;
        for(let i=styleArr.length-1; i>=0; i--) {
            if (Array.isArray(styleArr[i].styleText)) {
                styleArr[i].styleText = this.makeStyle(this.getSub(styleArr[i].styleText));
                continue;
            }
            let styleText = styleArr[i].styleText;
            const info = this.getInfo(styleText);
            for (let j=info.length-1; j>=0; j--) {
                let selector = styleText.substring(info[j].selectorStart, info[j].selectorEnd+1).trim();
                selector = selector.replaceAll('&', styleArr[i].selector);
                const style = styleText.substring(info[j].styleStart+1, info[j].styleEnd).trim();
                const text = styleText.substring(info[j].selectorStart, info[j].styleEnd+1);
                styleArr.splice(i+1,0,{
                    selector: selector,
                    styleText: style
                });
                styleText = styleText.replace(text, '');
                flag = true;
            }
            styleArr[i].styleText = styleText;
        }
        if (flag) return this.getSub(styleArr);
        return styleArr;
    }
    
    getInfo(styleText) {
        let info = [];
        let selectorStart = -1;
        let selectorEnd = -1;
        let styleStart = -1
        let styleEnd = -1;
        let braceBal = 0;
        for(let i=0; i<styleText.length; i++) {
            const oldBal = braceBal;
            const curStr = styleText[i];
            if (selectorStart === -1 && curStr === '&') selectorStart = i;
            if (selectorStart !== -1 && curStr === '{') { 
                if (styleStart === -1) { 
                    styleStart = i;
                    selectorEnd = i-1;
                }
                braceBal++;
            }
            if (styleStart !== -1 && curStr === '}') braceBal--;
            if (braceBal !== oldBal && braceBal === 0) {
                styleEnd = i;
                info.push({
                    selectorStart,
                    selectorEnd,
                    styleStart,
                    styleEnd
                });
                selectorStart = -1;
                selectorEnd = -1;
                styleStart = -1
                styleEnd = -1;            
            }
        }
        return info;
    }
    
    getStyle(styleText) {
        let styles = [];
        let selector = '';
        let strStack = '';
        let braceBal = 0;
        let oldBraceBal = 0;
        const braceMap = new Map([['{',1], ['}',-1]]);
        
        for(let i=0; i<styleText.length; i++) {
            const curStr = styleText[i];
            oldBraceBal = braceBal;
            braceBal += braceMap.get(curStr) === undefined ? 0 : braceMap.get(curStr);
            strStack += curStr;
            if (oldBraceBal!==braceBal && braceBal===0) {

                if (selector.includes('@media') || selector.includes('@supports')) {
                    styles.push({
                        selector: selector,
                        styleText: this.getStyle(strStack.substring(0, strStack.length-1).trim())
                    });
                } else {
                    styles.push({
                        selector: selector,
                        styleText: strStack.substring(0, strStack.length-1).trim()
                    });
                }
                strStack = '';
                selector = '';
            }
            if (oldBraceBal===0 && braceBal===1) {
                selector = strStack.substring(0, strStack.length-1).trim();
                strStack = '';
            }
        }
        return styles;
    }

    // partial render for data object or files
    async renderPart(dataText = "", type = "") {
        let source = "";
        let tempCode = [];
        let sync = [];
        if (type.trim() == "")
            return "select type from html, html_path";
        if (dataText.trim() == "")
            return "nothing to render";

        switch (type) {
            case "HTML":
                source = dataText;
                const { fileIncludedHTML } = await this.insertNestedHTML(source);
                // insert nested HTML modules
                const moduleIncludedHTML = this.insertModules(fileIncludedHTML);                
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
                const result = this.interpret(tempCode.type, tempCode.code);
                const returnValue = result.join("");
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
                const cssBlock = this.interpret(tempCode.type, tempCode.code);
                const combinedStyle = cssBlock.join("");
                // parse css string
                const cssRules = this.parseCSS(combinedStyle);
                const modifiedCss = this.createTextStyle(cssRules);
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
        const modifiedCss = cssObject.cssText || "";
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
        try { return Function(`"use strict"; return ( ${script.substring(1)} )`)(); }
        catch (e) {
            console.log(script);
            console.error(e);
            return `invalid template`;
        }
    }

    controlCode(script) {
        script = this.removeControlText(script);
        try { return Function(`"use strict"; ${script.replace(/[\n\r\t]/g, "")}`)(); }
        catch (e) {
            console.error(e);
            return `invalid template block`;
        }
    }

    currentUrl() {
        const urlHash = window.location.hash;
        const fullUrl = window.location.href.replace(urlHash, "");
        let fileName = fullUrl.split("/").pop();
        const host = fullUrl.substring(0, fullUrl.length - fileName.length); // host + path (without filename)
        if (urlHash !== "" && this.options.useHash) fileName = urlHash.substring(1) + ".html";
        return { host: host, filename: fileName };
    }

    async getTextFromFiles(urls) {
        if (urls.length == 0) return [];
        const requests = urls.map((url) => fetch(url));
        let responses = await Promise.allSettled(requests);
        let errorNo = [];
        responses.map((res, i) => {
            if (!res.value.ok) errorNo.push(i);
        });
        responses = responses.filter(res => res.value.ok);
        const successfulResponses = responses.map(res => res.value);
        responses = await Promise.all(successfulResponses);
        const responseTexts = responses.map(res => res.text());
        let insertedTexts = await Promise.all(responseTexts);
        errorNo.map(err => insertedTexts.splice(err, 0, "error: check your path to include from"));
        return insertedTexts;
    }

    removeAllChildNodes(parent) {
        while (parent.firstChild) {
            parent.removeChild(parent.firstChild);
        }
    }

    parseCSS(cssText) {
        if (cssText === undefined) return [];
        const commentRegex = /\/\*.*?\*\//g;
        const importsRegex = /@import .*?\(.*?\);/g;
        const keyframesRegex = /((@keyframes[\s\S]*?){([\s\S]*?}\s*?)})/g;
        const generalRegex = /((\s*?(?:\/\*[\s\S]*?\*\/)?\s*?(@media|@supports)[\s\S]*?){([\s\S]*?)}\s*?})|(([\s\S]*?){([\s\S]*?)})/g;
        let css = [];
        // remove comments
        cssText = cssText.replace(commentRegex, "");
        //get import
        const imports = [...cssText.matchAll(importsRegex)];
        const importsLen = imports.length;
        for (let i = 0; i < importsLen; i++) {
            const imported = imports[i];
            css.push({
                selector: "@imports",
                type: "imports",
                styles: imported[0],
            });
        }
        cssText = cssText.replace(importsRegex, "");
        // get keyframes
        const keyframes = [...cssText.matchAll(keyframesRegex)];
        const keyframesLen = keyframes.length;
        for (let i = 0; i < keyframesLen; i++) {
            const keyframe = keyframes[i];
            css.push({
                selector: "@keyframes",
                type: "keyframes",
                styles: keyframe[0],
            });
        }
        cssText = cssText.replace(keyframesRegex, "");
        // get general rules
        const generalRules = [...cssText.matchAll(generalRegex)];
        const genLen = generalRules.length;
        for (let i = 0; i < genLen; i++) {
            const generalRule = generalRules[i];
            let selector = generalRule[2] === undefined ? generalRule[6] : generalRule[2];
            selector = this.standardReturn(selector);
            const type = selector.includes("@media")
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
        const rulesLength = rules.length;
        for (let i = 0; i < rulesLength; i++) {
            let rule = rules[i];
            rule = rule.trim();
            // add splitted base64 code due to semi-colon just after "url('data:datatype/extension"
            if (!rule.includes(":") && rule.substring(0, 7) === "base64,") {
                parsedArr[parsedArr.length - 1].value += rule;
                continue;
            }
            // otherwise, it goes normal
            if (rule.includes(":")) {
                rule = rule.split(":");
                const cssKey = rule[0].trim();
                const cssValue = rule.slice(1).join(":").trim();
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
        const arrLen = arr1.length;
        for (let i = 0; i < arrLen; i++) {
            hash[arr1[i]] = i;
        }
        if (hash.hasOwnProperty(arr2)) return hash[arr2];
        return -1;
    }

    escapeHtml(str) {
        const map = {
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