"use strict";
/**
 * ! ver 1.8 : change from function to class
 * ! ver 1.81 : bug fix - preserve spaces and algorithm of finding last tag closure
 * Render and sync state changes of variable to HTML and CSS using template literals 
 * @class
 * @param {string} openDelimiter start tag of template
 * @param {string} closeDelimiter end tag of template
 * @param {string} syncClass class name to update
 * @param {string} startUrl if syncUrl is not defined for render(), startUrl can be loaded.
 */
class eTemplate {
    constructor({
        openDelimiter = "<%", closeDelimiter = "%>", syncClass = "et_sync", startUrl = "",
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
        this.startUrl = startUrl; // default url replacing index.html
        this.syncClass = syncClass; // class name to update
        this.openDelimiter = openDelimiter; // start tag of template
        this.closeDelimiter = closeDelimiter; // end tag of template
        this.commentDelimiter = openDelimiter + "%"; // start tag of comment template
    }

    /**
     * !Interpret CSS and HTML with templates and Render them
     * @param {string} fileName filename to render in <body>
     * @param {object} scrollObj Object for scroll in rendered page
     * @param {string} scrollObj.ID Id to find for scroll
     * @param {string} scrollObj.block position of elements with ID to scroll
     * @param {string} iScope scope for interpret. "": CSS and HTML, "body": only HTML
     */
    async render({ syncUrl: fileName = "", scrollTo: scrollObj = {}, iScope = "" } = {}) {
        this.syncCnt = 0;
        /**
         * Priority of fileName
         * 1. url in fileName
         * 2. url in startUrl
         * 3. this file's url
         */
        fileName = fileName === "" ? (this.startUrl !== "" ? this.startUrl : this.currentUrl().filename) : fileName;
        let myUrl = this.currentUrl().host + fileName;

        //  read first layer HTML
        const RESPONSE = await fetch(myUrl);
        const CURRENTHTML = await RESPONSE.text();
        // change title
        this.getTitle(CURRENTHTML);
        this.changeTitle(this.titleCode);
        // read multiple layers and proceed
        const RESULT = await this.readFurther(CURRENTHTML, iScope);
        // variables for sync()
        this.htmlCode = RESULT.codeList.code;
        this.htmlType = RESULT.codeList.type;        
        // remove current content of body and insert new content
        this.removeAllChildNodes(document.querySelector("body"));
        document.body.insertAdjacentHTML("afterbegin", RESULT.htmlBlock.join(""));
        // scroll to element of ID
        if (scrollObj != {} && Object.keys(scrollObj).length != 0) {
            let targetElement = document.getElementById(scrollObj.id);
            let blockArr = ["start", "center", "end"];
            let isInBlock = blockArr.some((el) => el == scrollObj.block);
            scrollObj.block = isInBlock ? scrollObj.block : "center";
            if (targetElement !== null) {
                document.getElementById(scrollObj.id).scrollIntoView({ block: scrollObj.block });
            }
        }
        // show document
        document.body.style.display = "block";
    }

    /**
     * read further nested HTML and process
     * @method
     * @param {string} currentHTML source HTML text which was loaded firstly (not interpreted yet)
     * @param {string} iScope scope for interpret. "": CSS and HTML, "body": only HTML
     * @returns {object} htmlBlock: interpreted codes array / codeList: object of code and type
     */
    async readFurther(currentHTML, iScope) {
        // CSS change in HEAD
        if (iScope !== "body") await this.changeCss(currentHTML); 
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
            sync = sync.map((x) => x + 1);
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
     * updates applied templates both on HTML and CSS if there are variable changes.
     * @param {string} iScope updating scope, whether it updates only HTML or also CSS.    
     * @returns nothing
     */
    sync(iScope) {
        let temp = "";
        let eClass = this.syncClass;
        let temp_code = "";
        // check and change title
        this.changeTitle(this.titleCode);

        // put values of input tags to related variables
        const inputEls = document.querySelectorAll(`input.${eClass}`);
        for (let i = 0; i < inputEls.length; i++) {
            let cList = inputEls[i];
            temp = "";
            temp = cList.getAttribute("data-sync");
            if (temp == null) continue;
            if (cList.type == "number") {
                temp += "=" + (cList.value ? `${this.escapeHtml(cList.value)};` : '"";');
            } else {
                temp += "=" + (cList.value ? `"${this.escapeHtml(cList.value)}";` : '"";');
            }
            try {
                temp_code = this.controlCode(temp);
            } catch (error) {
                return error;
            }
        }

        // interprete registered templates
        let htmlBlock = this.interpretPart(this.htmlType, this.htmlCode, eClass);

        // change current template to newly interpreted templates
        const eclassEls = document.querySelectorAll(`.${eClass}`);
        for (let i = 0; i < eclassEls.length; i++) {
            let cList = eclassEls[i];
            let classLists = cList.classList;
            let attrList = [];
            let isTemplateInAttribute = false;
            let index = 0;
            // get attribute to change from class
            let classListsLen = classLists.length;
            for (let j = 0; j < classListsLen; j++) {
                let classList = classLists[j];
                if (classList.includes(`${eClass}_`)) {
                    isTemplateInAttribute = true;
                    attrList = classList.split("_").pop().split("+");
                }
                if (classList.includes(`${eClass}Cnt`)) {
                    index = parseInt(classList.replace(`${eClass}Cnt`, ""), 10);
                }
            }
            if (isTemplateInAttribute) {
                for (let j = 0; j < attrList.length; j++) {
                    if (attrList[j] == "class") {
                        if (Array.isArray(htmlBlock[index])) {
                            cList.classList.remove(this.templateInClass[index]);
                            cList.classList.add(htmlBlock[index][j]);
                            this.templateInClass[index] = htmlBlock[index][j];
                        } else {
                            cList.classList.remove(this.templateInClass[index]);
                            cList.classList.add(htmlBlock[index]);                            
                            this.templateInClass[index] = htmlBlock[index];
                        }
                    } else {
                        if (Array.isArray(htmlBlock[index])) {
                            cList.setAttribute(attrList[j], htmlBlock[index][j]);
                        } else {
                            cList.setAttribute(attrList[j], htmlBlock[index]);
                        }
                    }
                }
            } else {
                this.removeAllChildNodes(cList);
                cList.insertAdjacentHTML("afterbegin", htmlBlock[index]);
            }
        }

        if (iScope != "body") {
            this.syncCss();
        }
    }

    /**
     * update templates in CSS where there are changes in variables 
     * @returns nothing
     */
    syncCss() {
        // if there is no template to interpret, return
        if (this.cssType.length == 0 || !this.cssType.includes("JS")) {
            return true;
        }
        // interpret seperated CSS and parse it to virtual CSS rules
        let htmlBlock = this.interpret(this.cssType, this.cssCode);
        let cssRules = this.parseCSS(htmlBlock.join("")); // changed CSS
        // find combined style tag
        let sheetNo = 0;
        for (let i = 0; i < document.styleSheets.length; i++) {
            if (document.styleSheets[i].href == null) {
                sheetNo = i;
                break;
            }
        }
        let cRules = this.cssRules; // current CSS
        let cRulesLen = cRules.length;
        const emptySpace = /\s+|\\n/g;
        let modifiedCss = "";
        let toAdd = [];
        let updatedRules = [];
        let cssRulesLen = cssRules.length;
        // check CSS change
        for (let i = 0; i < cssRulesLen; i++) {
            let cssRule = cssRules[i];
            let cssType = cssRule.type == undefined ? "" : cssRule.type;
            let currentIndex = -1;
            let typeNo = 0;
            let selector = "";
            switch (cssType) {
                case "keyframes":
                    for (let ci = 0; ci < cRulesLen; ci++) {
                        let cRule = cRules[ci];
                        let frameSelector = cssRule.styles.substring(0, cssRule.styles.indexOf("{")).trim();
                        let cframeSelector = cRule.styles.substring(0, cRule.styles.indexOf("{")).trim();
                        if (cRule.type == "keyframes" && frameSelector == cframeSelector) {
                            currentIndex = ci;
                            break;
                        }
                    }
                    // if found the same keyframes rules, change to new one
                    if (currentIndex > -1) {
                        let oldText = cRules[currentIndex].styles;
                        let newText = cssRule.styles;
                        if (oldText.replace(emptySpace, "") != newText.replace(emptySpace, "")) {
                            document.styleSheets[sheetNo].deleteRule(currentIndex);
                            document.styleSheets[sheetNo].insertRule(newText, currentIndex);
                        }
                        updatedRules.push([currentIndex, -2, 0, 7]);
                    } else {
                        toAdd.push(["rule", i, -1, -1, cssRule.styles]);
                    }
                    break;
                case "media":
                case "supports":
                    typeNo = cssType == "media" ? 4 : 12;

                    for (let ci = 0; ci < cRulesLen; ci++) {
                        let cRule = cRules[ci];
                        if (cRule.type == cssType && cssRule.selector == cRule.selector) {
                            currentIndex = ci;
                            break;
                        }
                    }
                    if (currentIndex > -1) {
                        cssRule.subStyles.forEach((subStyle, j) => {
                            selector = subStyle.selector;
                            let currentSubIndex = -1;
                            let subStylesLen = cRules[currentIndex].subStyles.length;
                            for (let cj = 0; cj < subStylesLen; cj++) {
                                if (cRules[currentIndex].subStyles[cj].selector == selector) {
                                    currentSubIndex = cj;
                                    break;
                                }
                            }
                            if (currentSubIndex > -1) {
                                subStyle.rules.forEach((rule, k) => {
                                    let currentStyle = -1;
                                    let ruleLen = cRules[currentIndex].subStyles[currentSubIndex].rules.length;
                                    for (let ck = 0; ck < ruleLen; ck++) {
                                        let styleKey = cRules[currentIndex].subStyles[currentSubIndex].rules[ck].key;
                                        if (styleKey == rule.key) {
                                            currentStyle = ck;
                                            break;
                                        }
                                    }
                                    if (currentStyle > -1) {
                                        let key = cRules[currentIndex].subStyles[currentSubIndex].rules[currentStyle].key;
                                        let oldValue = cRules[currentIndex].subStyles[currentSubIndex].rules[currentStyle].value;
                                        let newValue = rule.value;
                                        if (oldValue != newValue) {
                                            document.styleSheets[sheetNo].cssRules[currentIndex].cssRules[currentSubIndex].style.setProperty(key, newValue);
                                        }
                                        updatedRules.push([currentIndex, currentSubIndex, currentStyle, typeNo]);
                                    } else {
                                        toAdd.push(["style", i, j, k, rule.key, rule.value]);
                                    }
                                });
                            } else {
                                modifiedCss = "    " + subStyle.selector + " {\n";
                                for (let k = 0; k < subStyle.rules.length; k++) {
                                    modifiedCss =
                                        modifiedCss + `        ${subStyle.rules[k].key}: ${subStyle.rules[k].value};\n`;
                                }
                                modifiedCss = modifiedCss + "    }\n";
                                toAdd.push(["rule", i, j, -1, modifiedCss]);
                            }
                        });
                    } else {
                        modifiedCss = cssRule.selector + " {\n";
                        let cssRuleSubStylesLen = cssRule.subStyles.length;
                        for (let j = 0; j < cssRuleSubStylesLen; j++) {
                            let subStyle = cssRule.subStyles[j];
                            modifiedCss = modifiedCss + "    " + subStyle.selector + " {\n";
                            let subStyleRulesLen = subStyle.rules.length;
                            for (let k = 0; k < subStyleRulesLen; k++) {
                                modifiedCss =
                                    modifiedCss + `        ${subStyle.rules[k].key}: ${subStyle.rules[k].value};\n`;
                            }
                            modifiedCss = modifiedCss + "    }\n";
                        }
                        modifiedCss = modifiedCss + "}\n";
                        toAdd.push(["rule", i, -1, -1, modifiedCss]);
                    }

                    break;
                case "":
                case "font-face":
                    typeNo = cssType == "font-face" ? 5 : 1;

                    for (let ci = 0; ci < cRulesLen; ci++) {
                        let cRule = cRules[ci];
                        if (cssRule.selector == cRule.selector) {
                            currentIndex = ci;
                            break;
                        }
                    }
                    if (currentIndex > -1) {
                        let cssRuleRulesLen = cssRule.rules.length;
                        for (let j = 0; j < cssRuleRulesLen; j++) {
                            let rule = cssRule.rules[j];
                            let currentStyle = -1;
                            let cRulesRulesLen = cRules[currentIndex].rules.length;
                            for (let cj = 0; cj < cRulesRulesLen; cj++) {
                                let styleKey = cRules[currentIndex].rules[cj].key;
                                if (styleKey == rule.key) {
                                    currentStyle = cj;
                                    break;
                                }
                            }
                            if (currentStyle > -1) {
                                let key = cRules[currentIndex].rules[currentStyle].key;
                                let oldValue = cRules[currentIndex].rules[currentStyle].value;
                                let newValue = rule.value;
                                if (oldValue != newValue) {
                                    document.styleSheets[sheetNo].cssRules[currentIndex].style.setProperty(key, newValue);
                                }
                                updatedRules.push([currentIndex, -1, currentStyle, typeNo]);
                            } else {
                                modifiedCss = `    ${rule.key}: ${rule.value};\n`;
                                toAdd.push(["style", i, -1, j, rule.key, rule.value]);
                            }
                        }
                    } else {
                        modifiedCss = cssRule.selector + " {\n";
                        let cssRuleRulesLen = cssRule.rules.length;
                        for (let j = 0; j < cssRuleRulesLen; j++) {
                            modifiedCss = modifiedCss + `    ${cssRule.rules[j].key}: ${cssRule.rules[j].value};\n`;
                        }
                        modifiedCss = modifiedCss + "}\n";
                        toAdd.push(["rule", i, -1, -1, modifiedCss]);
                    }
                    break;
            }
        }

        // delete css
        let cssLength = cRules.length;
        let ruleLength = 0;
        let styleLength = 0;
        for (let i = cssLength - 1; i >= 0; i--) {
            let typeNo = 0;
            let cRule = cRules[i];
            switch (cRule.type) {
                case "media":
                case "supports":
                    typeNo = cRule.type == "media" ? 4 : 12;
                    ruleLength = cRule.subStyles.length;
                    for (let j = ruleLength - 1; j >= 0; j--) {
                        styleLength = cRule.subStyles[j].rules.length;
                        for (let k = styleLength - 1; k >= 0; k--) {
                            let isUpdated = this.arrayFind(updatedRules, [i, j, k, typeNo]);
                            if (isUpdated < 0) {
                                let targetProp = cRule.subStyles[j].rules[k].key;
                                document.styleSheets[sheetNo].cssRules[i].cssRules[j].style.removeProperty(targetProp);
                            }
                        }
                        if (document.styleSheets[sheetNo].cssRules[i].cssRules[j].style.length == 0) {
                            document.styleSheets[sheetNo].cssRules[i].deleteRule(j);
                        }
                    }
                    if (document.styleSheets[sheetNo].cssRules[i].cssRules.length == 0) {
                        document.styleSheets[sheetNo].deleteRule(i);
                    }
                    break;
                case "":
                case "font-face":
                    typeNo = cRule.type == "" ? 1 : 5;
                    styleLength = cRule.rules.length;
                    for (let j = styleLength - 1; j >= 0; j--) {
                        let isUpdated = this.arrayFind(updatedRules, [i, -1, j, typeNo]);
                        if (isUpdated < 0) {
                            let targetProp = cRule.rules[j].key;
                            document.styleSheets[sheetNo].cssRules[i].style.removeProperty(targetProp);
                        }
                    }

                    if (document.styleSheets[sheetNo].cssRules[i].style.length == 0) {
                        document.styleSheets[sheetNo].deleteRule(i);
                    }
                    break;
                case 7:
                    let isUpdated = this.arrayFind(updatedRules, [i, -2, 0, 7]);
                    if (isUpdated < 0) {
                        document.styleSheets[sheetNo].deleteRule(i);
                    }
                    break;
            }
        }
        // add css
        let toAddLen = toAdd.length;
        for (let i = 0; i < toAddLen; i++) {
            let [addType, rule1, rule2, style1, prop, value = ""] = toAdd[i];

            if (addType == "style") {
                if (rule2 == -1) {
                    document.styleSheets[sheetNo].cssRules[rule1].style.setProperty(prop, value);
                } else {
                    document.styleSheets[sheetNo].cssRules[rule1].cssRules[rule2].style.setProperty(prop, value);
                }
            } else {
                if (rule2 == -1) {
                    document.styleSheets[sheetNo].insertRule(prop, rule1);
                } else {
                    document.styleSheets[sheetNo].cssRules[rule1].insertRule(prop, rule2);
                }
            }
        }
        // replace this.cssRules
        this.cssRules = JSON.parse(JSON.stringify(cssRules));
    }

    /**
     * find <% include %> template in HTML text
     * @param {string} currentHTML 
     * @returns {object} urls: urls in include template / order: array of code number pointing where the template is / codeList: seperated HTML codes
     */
    findInclude(currentHTML) {
        let includeArray = []; // only JS script in body
        let urls = []; // url for inclusion
        let orders = []; // index of include script out of code array
        let tempString = "";
        let cnt = 0;
        let currentBodyHTML = "";
        let startPos = currentHTML.indexOf("<body>");
        let endPos = currentHTML.indexOf("</body>");
        currentBodyHTML = startPos == -1 || endPos == -1 ? currentHTML : currentHTML.substring(startPos + 6, endPos);
        let { codes, types } = this.seperateCode(currentBodyHTML, "first")
        let typeLen =types.length;
        for (let i = 0; i < typeLen; i++) {
            if (types[i] == "JS" && codes[i].search(/include\(.*\)/g) != -1) {
                includeArray.push(codes[i]);
                orders[cnt] = i;
                cnt++;
            }
        }
        // if include() exists, get urls from script
        if (includeArray.length != 0) {
            includeArray.forEach((script) => {
                if (script.includes("include(")) {
                    startPos = script.indexOf('include("');
                    if (startPos == -1) {
                        startPos = script.indexOf("include('") + 9;
                    } else
                        startPos = startPos + 9;
                    endPos = script.indexOf('")');
                    if (endPos == -1) {
                        endPos = script.indexOf("')");
                    }
                    tempString = script.substring(startPos, endPos);
                    tempString = tempString.substring(0, 1) == "/" ? tempString.substring(1) : tempString;
                    tempString = tempString.substring(0, 2) == "./" ? tempString.substring(2) : tempString;
                    urls.push(this.currentUrl().host + tempString);
                }
            });
        }
        return {
            urls,
            orders,
            codeList: codes,
        };
    }

    /**
     * Insert nested HTML text from external files to source HTML text
     * @param {string} currentHTML HTML text source with nested files
     * @returns {object} fileIncludedHTML: HTML text with included HTML text / codeList: array of seperated codes
     */
    async insertNestedHTML(currentHTML) {
        let fileIncludedHTML = "";
        let { urls, orders, codeList } = this.findInclude(currentHTML);
        if (urls.length == 0) {
            fileIncludedHTML = codeList.join("");
            return { fileIncludedHTML, codeList };
        }
        let insertedHTMLs = await this.getTextFromFiles(urls);
        // insert HTML of files into the places of each include() scripts.
        insertedHTMLs.forEach((insertedHTML, i) => {
            codeList[orders[i]] = insertedHTML;
        });
        // new HTML with included HTML
        fileIncludedHTML = codeList.join("");
        ({ urls, orders, codeList } = this.findInclude(fileIncludedHTML));
        if (urls.length == 0) return { fileIncludedHTML, codeList };
        ({ fileIncludedHTML, codeList } = await this.insertNestedHTML(fileIncludedHTML));
        return { fileIncludedHTML, codeList };
    }

    /**
     * Insert nested HTML text from modules to source HTML text
     * @param {string} currentHTML HTML text with nested modules
     * @returns {string} HTML text inserted with modules
     */
    insertModules(currentHTML) {
        let {types, codes} = this.seperateCode(currentHTML, "first");
        let cnt = 0;
        let typeLen = types.length;
        for (let i = 0; i < typeLen; i++) {
            // check whether a code has a module
            if (types[i] == "JS" && codes[i].includes("<%#")) {
                let tempString = codes[i].match(/(?<=<%#).*(?=%>)/)[0];
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
        if (cnt !== 0)
            // recursive call for multi-layer modules
            result = this.insertModules(result);
        return result;
    }

    /**
     * Seperate templates or template blocks out of HTML text  
     * @param {string} html HTML text
     * @param {string} calltype "first" seperate templates as they are / "second" seperate only inside of templates delimiters
     * @returns {object} code: array of seperated codes / type: array of code types
     */
    seperateCode(html, calltype) {
        const regexText = `(${this.openDelimiter}[^%].*?${this.closeDelimiter})`;
        const templateRegex = new RegExp(regexText, "g");
        // const templateRegex = /(<%[^%].*?%>)/g;
        let codes = html.split(templateRegex);
        let types = [];
        let codesLen = codes.length;
        for (let i = 0; i < codesLen; i++) {
            let code = codes[i];
            let firstIndex = code.indexOf(`${this.openDelimiter}`);
            let lastIndex = code.indexOf(`${this.closeDelimiter}`);
            let codeType = "";
            if (firstIndex == 0 && lastIndex == code.length - 2 && !code.includes("closeDelimiter:")) {
                codeType = "JS";
                codes[i] = calltype == "second" ? code.substring(2, code.length - 2).trim() : code;
            } else {
                codeType = "HTML";
            }
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
                    if (code[cnt].substring(0, 1) == "=" || code[cnt].substring(0, 1) == "-") {
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

    interpretPart(oType, oCode, eClass) {
        // declare variables
        let htmlBlock = [];
        let tempStr = "";
        let nType = [];
        let nCode = [];
        let tags = [];
        let i = 0;
        let j = 0;
        let blockNo = 0;
        let cnt = 0;
        let escapedOpenComment = this.escapeHtml(this.commentDelimiter.replace(this.commentDelimiter, this.openDelimiter));
        let escapedCloseComment = this.escapeHtml(this.closeDelimiter);

        let oCodeLen = oCode.length;
        for (i = 0; i < oCodeLen; i++) {
            tags.length = 0;
            if (oType[i] == "HTML") {
                j = 0;
                tempStr = "";
                tags = this.removeControlText(oCode[i]).split("<");
                tags.forEach((tag) => {
                    if (tag.includes("class=") && tag.includes(eClass)) {
                        tempStr = tag.substring(0, tag.indexOf(" ")).trim();
                    }
                });
                if (tempStr.length > 0) {
                    blockNo = this.htmlSync[i + 1];
                    for (j = i + 1; j < oCode.length; j++) {
                        if (this.htmlSync[j] == blockNo) {
                            nType.push(oType[j]);
                            nCode.push(oCode[j]);
                        } else {
                            break;
                        }
                    }
                }
            }
        }

        let nCodeLen = nCode.length;
        let attrFlag = 0;
        while (cnt < nCodeLen) {
            switch (nType[cnt]) {
                // HTML, as it is
                case "HTML":
                    if (nCode[cnt].substring(nCode[cnt].length - 2) !== `="`) {
                        htmlBlock.push(
                            nCode[cnt]
                                .replaceAll(this.commentDelimiter, escapedOpenComment)
                                .replaceAll(this.closeDelimiter, escapedCloseComment)
                        );
                        break;
                    } else {
                        attrFlag = 1;
                        break;
                    }
                // JS
                case "JS":
                    if (attrFlag == 0) {
                        if (nCode[cnt].substring(0, 1) == "=" || nCode[cnt].substring(0, 1) == "-") {
                            // single line script
                            try {
                                htmlBlock.push(this.basicCode(nCode[cnt]));
                            } catch (error) {
                                htmlBlock.push("invalid template script");
                            }
                            break;
                        } else {
                            // multi line script block
                            let block_data = this.eachBlock(nType, nCode, cnt);
                            cnt = block_data.index; // to next block
                            try {
                                htmlBlock.push(this.controlCode(block_data.partBlock));
                            } catch (error) {
                                htmlBlock.push("invalid template script");
                            }
                            break;
                        }
                    } else {
                        if (nCode[cnt].substring(0, 1) == "=" || nCode[cnt].substring(0, 1) == "-") {
                            // single line script
                            try {
                                if (Array.isArray(htmlBlock[htmlBlock.length - 1])) {
                                    htmlBlock[htmlBlock.length - 1].push(this.basicCode(nCode[cnt]));
                                } else {
                                    htmlBlock[htmlBlock.length - 1] = [
                                        htmlBlock[htmlBlock.length - 1],
                                        this.basicCode(nCode[cnt]),
                                    ];
                                }
                            } catch (error) {
                                htmlBlock.push("invalid template script");
                            }
                            attrFlag = 0;
                            break;
                        } else {
                            // multi line script block
                            let block_data = this.eachBlock(nType, nCode, cnt);
                            cnt = block_data.index; // to next block
                            try {
                                htmlBlock.push(this.controlCode(block_data.partBlock));
                            } catch (error) {
                                htmlBlock.push("invalid template script");
                            }
                            attrFlag = 0;
                            break;
                        }
                    }
            } // switch:end
            cnt++;
        } // for:while

        return htmlBlock;
    }

    makeSyncBlock(type, code) {
        let sync = [];
        let cnt = 0;
        let index = 0;
        let braceBalance = 0;
        let codeLen = code.length;

        for (let i = 0; i < codeLen; i++) {
            switch (type[i]) {
                // HTML, as it is
                case "HTML":
                    sync.push(cnt);
                    break;
                // JS
                case "JS":
                    if (code[i].substring(0, 1) == "=" || code[i].substring(0, 1) == "-") {
                        // sing line script
                        sync.push(cnt);
                        break;
                    } else {
                        // multi line script block
                        index = this.findBlockEnd(type, code, i).index;
                        braceBalance = this.findBlockEnd(type, code, i).braceBalance;
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
                if (code[j].includes("{"))
                    bracesCnt++;
                if (code[j].includes("}"))
                    bracesCnt--;
                if (bracesCnt == 0)
                    return { index: j, error: 0 };
                continue;
            }
            // additional blocks
            // HTML
            if (type[j] == "HTML")
                continue;
            // JS
            if (type[j] == "JS" && code[j].substring(0, 1) != "=" && code[j].substring(0, 1) != "-") {
                if (code[j].includes("{"))
                    bracesCnt++;
                if (code[j].includes("}"))
                    bracesCnt--;
                if (bracesCnt == 0)
                    return { index: j, error: 0 };
            }
        }
        if (bracesCnt != 0)
            return { index: i, braceBalance: bracesCnt };
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
                    if (code[j].includes("{"))
                        bracesCnt++;
                    if (code[j].includes("}"))
                        bracesCnt--;
                    if (bracesCnt == 0)
                        return { partBlock: code[j], index: j };
                    partBlock = `let eTemplateInterpreted=''; ${code[j]}`;
                    continue;
                } else {
                    partBlock = `let eTemplateInterpreted='${code[j]}';`;
                }
            }
            // additional blocks
            // HTML
            if (type[j] == "HTML") {
                partBlock += `eTemplateInterpreted += '${code[j]}';`;
                continue;
            }
            // JS
            if (type[j] == "JS") {
                if (code[j].substring(0, 1) == "=" || code[j].substring(0, 1) == "-") {
                    partBlock += `eTemplateInterpreted += ${code[j].substring(1)};`;
                } else {
                    partBlock += code[j];
                    if (code[j].includes("{"))
                        bracesCnt++;
                    if (code[j].includes("}"))
                        bracesCnt--;
                    if (bracesCnt == 0) {
                        partBlock += `; return eTemplateInterpreted;`;
                        return { partBlock: partBlock, index: j };
                    }
                }
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
        let nextCode = "";
        let startBlock = 0;
        let endBlock = 0;
        let classStart = 0;
        let attrList = [];
        let syncCnt = this.syncCnt;
        let syncLen = sync.length;
        const eClass = this.syncClass;

        for (let i = 0; i < syncLen; i++) {
            if (type[i]=="JS") code[i] = code[i].trim();

            if (sync[i] != lastSync && type[i] == "JS") {
                lastSync = sync[i];
                endBlock = 0;
                classStart = 0;
                startBlock = i;
                endBlock = sync.lastIndexOf(sync[startBlock]);
                prevCode = code[i - 1];
                attrList = [];
                let controlRemovedPrevCode = this.removeControlText(prevCode);
                let endBlank = controlRemovedPrevCode.length - controlRemovedPrevCode.trimEnd().length;
                let lastLetter = controlRemovedPrevCode.substring(controlRemovedPrevCode.length - endBlank - 1).trim();

                if (lastLetter != ">") {
                    // previous HTML is not ended width tag
                    endPos = prevCode.lastIndexOf(">");
                    startPos = prevCode.lastIndexOf("<");

                    if (endPos < startPos) {
                        // template in the middle of prev and next code, which means template is used in attributes
                        tempStr = prevCode.substring(startPos);
                        // extract the first attribute key
                        attrList.push(prevCode.substring(prevCode.lastIndexOf(" ",prevCode.lastIndexOf(`="`)) + 1, prevCode.lastIndexOf(`="`)));

                        // find the block end
                        for (let j = i + 1; j < syncLen; j++) {
                            if (type[j] === "HTML" && code[j].indexOf(">") > 0) {
                                for (let k = i + 1; k < j; k++) {
                                    sync[k] = sync[i];
                                }
                                endBlock = sync.lastIndexOf(sync[i]);
                                break;
                            }
                        }
                        for (let j = i + 1; j <= endBlock; j++) {
                            if (type[j] === "HTML" && code[j].includes('="') && type[j + 1] == "JS") {
                                attrList.push(code[j].substring(code[j].lastIndexOf(" ") + 1, code[j].lastIndexOf("=")));
                            }
                        }
                        let attrText = attrList.join("+");
                        if (tempStr.includes("class=")) {
                            // class in the previous code
                            classStart = prevCode.indexOf("class=", startPos) + 7;
                            code[i - 1] = `${prevCode.substring(0, classStart)}${eClass} ${eClass}_${attrText} ${eClass}Cnt${syncCnt} ${prevCode.substring(classStart)}`;
                            this.templateInClass[syncCnt] = this.basicCode(code[i].replace('=',''));
                            syncCnt++;
                        } else {
                            // check there is a class in the next code
                            nextCode = code[i + 1];
                            endPos = nextCode.indexOf(">");
                            tempStr = nextCode.substring(0, endPos);
                            if (tempStr.includes("class=")) {
                                // there is a class in the next code
                                classStart = nextCode.indexOf("class=") + 7;
                                code[i + 1] = `${nextCode.substring(
                                    0,
                                    classStart
                                )}${eClass} ${eClass}_${attrText} ${eClass}Cnt${syncCnt} ${nextCode.substring(classStart)}`;
                                syncCnt++;
                            } else {
                                // there is no class in the next code, either
                                startPos = prevCode.lastIndexOf("<");
                                endPos = prevCode.indexOf(" ", startPos);
                                code[i - 1] = `${prevCode.substring(
                                    0,
                                    endPos + 1
                                )} class="${eClass} ${eClass}_${attrText} ${eClass}Cnt${syncCnt}" ${prevCode.substring(
                                    endPos + 1
                                )}`;
                                syncCnt++;
                            }
                        }
                    } else {
                        // not in the middle and there is text elements before this template
                        code[i - 1] = code[i - 1] + `<span class="${eClass} ${eClass}Cnt${syncCnt}">`;
                        syncCnt++;
                        code[endBlock + 1] = "</span>" + code[endBlock + 1];
                    }
                } else {
                    // previous HTML is ended width tag
                    startPos = prevCode.lastIndexOf("<");
                    endPos = prevCode.lastIndexOf(">");
                    spacePos = prevCode.indexOf(" ", startPos);
                    if (spacePos == -1 || spacePos > endPos) {
                        tagStr = prevCode.substring(startPos + 1, endPos);
                    } else {
                        tagStr = prevCode.substring(startPos + 1, prevCode.length).split(" ")[0];
                    }

                    if (prevCode.substring(startPos, startPos + 2) != "</") {

                        console.log(i, tagStr);
                        console.log(code[endBlock + 1]);

                        //  if previous code is not ended with end tag
                        if (code[endBlock + 1].includes("</" + tagStr) && 
                            code[endBlock + 1].indexOf("</" + tagStr) <
                            (code[endBlock + 1].indexOf("<" + tagStr) == -1
                                ? code[endBlock + 1].length
                                : code[endBlock + 1].indexOf("<" + tagStr))) {
                            if (this.removeControlText(code[endBlock + 1]).trim().indexOf("</" + tagStr) == 0) {
                                // end tag is at the first in the next code
                                endPos = prevCode.length;
                                startPos = prevCode.lastIndexOf("<");
                                tempStr = prevCode.substring(startPos, endPos);
                                if (tempStr.includes("class=")) {
                                    classStart = prevCode.indexOf("class=", startPos) + 7;
                                    code[i - 1] = `${prevCode.substring(
                                        0,
                                        classStart
                                    )}${eClass} ${eClass}Cnt${syncCnt} ${prevCode.substring(classStart)}`;
                                    syncCnt++;
                                } else {

                                    endPos = prevCode.lastIndexOf(">");
                                    code[i - 1] = `${prevCode.substring(
                                        0,
                                        endPos
                                    )} class="${eClass} ${eClass}Cnt${syncCnt}" ${prevCode.substring(
                                        endPos,
                                        prevCode.length
                                    )}`;
                                    syncCnt++;
                                }
                            } else {
                                // end tag is in the middle in the next code, which means there is text before the end tag
                                startPos = 0;
                                endPos = code[endBlock + 1].indexOf("</");
                                code[i - 1] = `${code[i - 1]}<span class="${eClass} ${eClass}Cnt${syncCnt}">`;
                                syncCnt++;
                                code[endBlock + 1] = `</span>${code[endBlock + 1]}`;
                            }
                        } else {
                            // no tag in the next
                            code[i - 1] = `${code[i - 1]}<span class="${eClass} ${eClass}Cnt${syncCnt}">`;
                            syncCnt++;
                            code[endBlock + 1] = `</span>${code[endBlock + 1]}`;
                        }
                    } else {
                        code[i - 1] = `${code[i - 1]}<span class="${eClass} ${eClass}Cnt${syncCnt}">`;
                        syncCnt++;
                        code[endBlock + 1] = `</span>${code[endBlock + 1]}`;
                    }
                }
            } else {
                lastSync = sync[i];
            }
        }
        return { type: type, code: code, syncCnt };
    }

    getTitle(currentHTML) {
        const headRegexp = /<head>(.|[\t\n\r])*?<\/head>/g;
        const titleRegexp = /<title>(.|[\t\n\r])*?<\/title>/g;
        const headHTML = currentHTML.match(headRegexp)[0];
        const titleCode = headHTML.match(titleRegexp)[0].replace("<title>", "").replace("</title>", "").trim();
        this.titleCode = titleCode.length > 0 ? titleCode : this.titleCode;
    }

    changeTitle(templateTitle) {
        const regexText = `${this.openDelimiter}[^%].*?${this.closeDelimiter}`;
        const templateRegex = new RegExp(regexText, "g");
        // interpret template of title
        let titleCode = null;
        if (this.titleCode.trim().match(templateRegex) != null) {
            titleCode = templateTitle
                .trim()
                .match(templateRegex)[0]
                .replaceAll(`${this.openDelimiter}`, "")
                .replaceAll(`${this.closeDelimiter}`, "");
        }
        let titleResult = "";
        if (titleCode != null) {
            titleResult = this.basicCode(titleCode);
            document.head.querySelector("title").innerText = titleResult;
        }
    }

    async changeCss(newHTML) {
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
        if (modifiedCss == "")
            return;
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

    async combineCss(newHTML) {
        // declare variables
        const linkregexp = /<link.*?(rel=("|')stylesheet("|')).*?>/gi;
        const styleregexp = /<style>(.|[\t\n\r])*?<.style>/gi;
        const getHref = (str) => {
            return str
                .match(/href=".*?"/gi)[0]
                .replaceAll("href=", "")
                .replaceAll('"', "");
        };
        let urls = [];
        let styleBlock = [];

        // if there is no head tag to parse
        let startPos = newHTML.indexOf("<head>");
        let endPos = newHTML.indexOf("</head>");
        if (startPos == -1 || endPos == -1) {
            return "";
        } // if there is no head tag to parse

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
            if (!linkHref.includes("http")) {
                urls.push(relUrl + linkHref);
            }
        });
        // read and combine css files
        let importedStyles = await this.getTextFromFiles(urls);
        combinedStyle = importedStyles.reduce((acc, style) => {
            return acc + style;
        }, combinedStyle);
        combinedStyle = await this.insertNestedCSS(combinedStyle);
        return combinedStyle;
    }

    async insertNestedCSS(styleText) {
        let finalCSS = "";
        // get urls of css to import, where to insert, seperated css array
        let { urls, orders, codes } = this.findImport(styleText);
        if (urls.length == 0) {
            // if there is no @import at all
            finalCSS = codes.join("");
            return finalCSS;
        }
        let insertedCSSs = await this.getTextFromFiles(urls);
        // insert CSS of files into each @import
        insertedCSSs.forEach((insertedCSS, i) => {
            codes[orders[i]] = insertedCSS;
        });
        // new CSS with imported CSS
        finalCSS = codes.join("");
        // find further nested @import
        ({ urls, orders, codes } = this.findImport(finalCSS));
        if (urls.length != 0) {
            // recursively insert css from imported css files
            finalCSS = await this.insertNestedCSS(finalCSS);
            return finalCSS;
        } else {
            // if there is no more @import...
            return finalCSS;
        }
    }

    findImport(styleText) {
        // declare variables
        let importArray = []; // only @import in CSS
        let urls = []; // url for inclusion
        let orders = []; // index of @import out of array
        let tempString = "";
        let cnt = 0;
        const importRegex = /@import[\s\S]*?["|'].*?["|'];/g;
        // categorize CSS to @IMPORT and OTHER
        let { types, codes } = this.seperateImport(styleText);
        // only @import to includeArray
        for (let i = 0; i < types.length; i++) {
            if (types[i] == "IMPORT" &&
                codes[i].search(importRegex) != -1 &&
                !codes[i].includes("http")) {
                importArray.push(codes[i]);
                orders[cnt] = i;
                cnt++;
            }
        }
        // if @import exists, get pathname from CSS
        if (importArray.length != 0) {
            importArray.forEach((script) => {
                tempString = script
                    .match(importRegex)[0]
                    .replaceAll("@import", "")
                    .replaceAll('"', "")
                    .replaceAll(";", "\n")
                    .trim();
                tempString = tempString.substring(0, 1) == "/" ? tempString.substring(1) : tempString;
                tempString = tempString.substring(0, 2) == "./" ? tempString.substring(2) : tempString;
                urls.push(this.currentUrl().host + tempString);
            });
        }
        return {
            urls,
            orders,
            codes,
        };
    }

    seperateImport(styleText) {
        // seperate @import and other css to types and codes
        const importRegex = /(@import *["|'].*?["|'];)/g;
        let codes = styleText.split(importRegex);
        let types = [];
        let codesLen = codes.length;
        for (let index = 0; index < codesLen; index++) {
            let code = codes[index];
            let type = code.includes("@import") ? "IMPORT" : "OTHER";
            types.push(type);
            codes[index] = code.includes("@import") ? code.trim() : this.removeControlText(code).trim();
        }
        return { types, codes };
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
                        modifiedCss = modifiedCss + `    ${rule.key}: ${rule.value};\n`;
                    });
                    modifiedCss = modifiedCss + "}\n";
                    break;
                case "imports":
                case "keyframes":
                    modifiedCss =
                        modifiedCss +
                        cssRule.styles.replaceAll("{", "{\n").replaceAll("}", "}\n").replaceAll(";", ";\n") +
                        "\n";
                    break;
                case "supports":
                case "media":
                    modifiedCss = modifiedCss + cssRule.selector + " {\n";
                    cssRule.subStyles.forEach((subStyle) => {
                        modifiedCss = modifiedCss + "    " + subStyle.selector + " {\n";
                        subStyle.rules.forEach((rule) => {
                            modifiedCss = modifiedCss + `        ${rule.key}: ${rule.value};\n`;
                        });
                        modifiedCss = modifiedCss + "    }\n";
                    });
                    modifiedCss = modifiedCss + "}\n";
                    break;
            }
        }
        return modifiedCss;
    }

    basicCode(script) {
        try {
            return Function(`"use strict"; return ( ${script.substring(1)} )`)();
        } catch (e) {
            return `${e.message}`;
        }
    }

    controlCode(script) {
        try {
            return Function(`"use strict"; ${script.replace(/[\n\r\t]/g, "")}`)();
        } catch (e) {
            return `invalid template block`;
        }
    }

    // partial render for data object or files
    async renderPart(dataText = "", type = "") {
        let source = "";
        let result = "";
        let path = "";
        let sync = [];
        let types = [];
        let codes = [];
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
            case "html":
                source = dataText;
                ({ types, codes } = this.seperateCode(source, "second"));
                sync = this.makeSyncBlock(types, codes);
                if (types[0] == "JS") {
                    types.unshift("HTML");
                    codes.unshift(" ");
                    sync = sync.map((x) => x + 1);
                    sync.unshift(0);
                }
                ({ types, codes, syncCnts } = this.insertSync(types, codes, sync));
                this.syncCnt = syncCnts;
                result = this.interpret(types, codes);
                returnValue = result.join("");
                return {
                    domText: returnValue,
                    sourceType: types,
                    sourceCode: codes,
                    sourceSync: sync,
                };
            case "html_path":
                path = this.currentUrl().host + dataText;
                try {
                    const response = await fetch(path);
                    source = await response.text();
                } catch (e) {
                    return "incorrect pathname";
                }
                ({ types, codes } = this.seperateCode(source, "second"));
                sync = this.makeSyncBlock(types, codes);
                if (types[0] == "JS") {
                    types.unshift("HTML");
                    codes.unshift(" ");
                    sync = sync.map((x) => x + 1);
                    sync.unshift(0);
                }
                ({ types, codes, syncCnts } = this.insertSync(types, codes, sync));
                this.syncCnt = syncCnts;
                result = this.interpret(types, codes);
                returnValue = result.join("");
                return {
                    domText: returnValue,
                    sourceType: types,
                    sourceCode: codes,
                    sourceSync: sync,
                };
            case "css":
                source = dataText;
                source = await this.insertNestedCSS(source);
                // seperate style text to template and others
                ({ types, codes } = this.seperateCode(source, "second"));
                // interpret templates
                cssBlock = this.interpret(types, codes);
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
            case "css_path":
                path = this.currentUrl().host + dataText;
                try {
                    const response = await fetch(path);
                    source = await response.text();
                } catch (e) {
                    return "incorrect pathname";
                }
                source = await this.insertNestedCSS(source);
                ({ types, codes } = this.seperateCode(source, "second"));
                // interpret templates
                cssBlock = this.interpret(types, codes);
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

    appendHtml(obj = {}, element) {
        let domText = obj.domText || "";
        if (element == undefined)
            return "no element to append to";
        const tempType = obj.sourceType || [];
        const tempCode = obj.sourceCode || [];
        const tempSync = obj.sourceSync || [];
        if (this.getObjectType(element) != "DOMobject") {
            return "invalid object to append to";
        }
        if (tempType.length == 0)
            return "nothing to append";
        // adding template information for sync
        this.htmlType = [...this.htmlType, ...tempType];
        this.htmlCode = [...this.htmlCode, ...tempCode];
        this.htmlSync = [...this.htmlSync, ...tempSync];
        // appending interpreted html to element
        domText = domText.trim();
        if (domText == "")
            return "nothing to append";
        element.insertAdjacentHTML("beforeend", domText);
    }

    appendCss(cssObject = {}) {
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
            return;
        }
        styleElement = document.createTextNode(modifiedCss);
        document.querySelector("style").appendChild(styleElement);
        this.cssRules = [...this.cssRules, ...cssRules];
        this.cssType = [...this.cssType, ...cssType];
        this.cssCode = [...this.cssCode, ...cssCode];
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
        if (urls.length == 0)
            return [];
        let requests = urls.map((url) => fetch(url));
        let responses = await Promise.allSettled(requests);
        let errorNo = [];
        responses.map((res, i) => {
            if (!res.value.ok) {
                errorNo.push(i);
            }
        });
        responses = responses.filter((res) => res.value.ok);
        let successfulResponses = responses.map((res) => res.value);
        responses = await Promise.all(successfulResponses);
        let responseTexts = responses.map((res) => res.text());
        let insertedTexts = await Promise.all(responseTexts);
        errorNo.map((err) => insertedTexts.splice(err, 0, "error: check your path"));
        return insertedTexts;
    }

    // check object type for renderPart()
    getObjectType(o) {
        if (typeof HTMLElement === "object"
            ? o instanceof HTMLElement
            : o && typeof o === "object" && o !== null && o.nodeType === 1 && typeof o.nodeName === "string") {
            return "DOMobject";
        } else {
            return o.includes("<%") && o.includes("%>")
                ? "template"
                : o.includes(".html")
                    ? "html_path"
                    : o.includes(".css")
                        ? "css_path"
                        : "undefined";
        }
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
}

// mouse is on inside or outside of document
document.onmouseover = function () {
    window.innerDocClick = true;
};
document.onmouseleave = function () {
    window.innerDocClick = false;
};