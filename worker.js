class myWorker {
    constructor({
        openDelimiter = "<%", closeDelimiter = "%>"
    } = {}) {
        this.titleCode = ""; // HTML for title 
        this.openDelimiter = openDelimiter; // start tag of template
        this.closeDelimiter = closeDelimiter; // end tag of template
        this.commentDelimiter = openDelimiter + "%"; // start tag of comment template
        this.url = "";
        this.titleCode = "";
        this.metaArray = [];
    }

    async readFurther(scope, currentUrl) {
        let cssText ="";
        const res = await fetch(currentUrl);
        let currentHTML = await res.text();
        this.readMeta(currentHTML);
        this.getTitle(currentHTML);
        this.url = currentUrl;
        // CSS change in HEAD
        if (scope !== "body") { cssText = await this.changeCss(currentHTML); }
        // insert nested HTML files
        const result = await this.insertNestedHTML(currentHTML);
        let fileIncludedHTML = result.fileIncludedHTML;
        // interprete template scripts
        return { 
            fileIncludedHTML,
            cssText,
            filename: this.currentUrl().filename,
            titleCode: this.titleCode,
            metaArray: this.metaArray
        };
    }

    /**
     * find <% include %> template in HTML text
     * @param {string} currentHTML 
     * @returns {object} urls: urls in include template / order: array of code number pointing where the template is / codeList: seperated HTML codes
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
        let cnt = 0;
        let currentBodyHTML = "";
        currentBodyHTML = currentHTML.match(bodyRegexp) === null ? currentHTML : currentHTML.match(bodyRegexp)[0].replace(bodyStartRegexp, "").replace(bodyEndRegexp, "");
        let { codes, types } = this.seperateCode(currentBodyHTML, "first")
        let typeLen =types.length;
        let relUrl = this.currentUrl().host;
        for (let i = 0; i < typeLen; i++) {
            if (types[i] == "JS" && includeRegexp.test(codes[i])) {
                tempString = codes[i].match(includeRegexp)[0].replace(includeStartRegexp, '').replace(includeEndRegexp, '');
                urls.push(new URL( tempString, relUrl).href);
                orders[cnt] = i;
                cnt++;
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
     * @param {string} currentHTML HTML text source with nested files
     * @returns {object} fileIncludedHTML: HTML text with included HTML text / codeList: array of seperated codes
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
        // new HTML with included HTML
        fileIncludedHTML = this.removeComment(codeList.join(""));
        return await this.insertNestedHTML(fileIncludedHTML, relativeUrls);
    }

    /**
     * Seperate templates or template blocks out of HTML text  
     * @param {string} html HTML text
     * @param {string} calltype "first" seperate templates as they are / "second" seperate only inside of templates delimiters
     * @returns {object} code: array of seperated codes / type: array of code types
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

    getTitle(currentHTML) {
        const headRegexp = /<head>[\s\S]*?<\/head>/g;
        const titleRegexp = /<title>[\s\S]*?<\/title>/g;
        const headHTML = currentHTML.match(headRegexp) == null ? "" : currentHTML.match(headRegexp)[0];
        const titleCode = headHTML.match(titleRegexp) == null ? "" : headHTML.match(titleRegexp)[0].replace("<title>", "").replace("</title>", "").trim();
        this.titleCode = titleCode.length > 0 ? titleCode : this.titleCode;
    }        

    readMeta(currentHTML) {
        const metaRegStr = `\\<meta[\\s\\S]*?[^${this.closeDelimiter}]\\>`;
        const metaRegex = new RegExp(metaRegStr, 'g');
        const attributeRegex = /([\w|\-|\_]*) *= *((['"])?((\\\3|[^\3])*?)\3|(\w+))/g;
        const metaTags = [...currentHTML.matchAll(metaRegex)];
        let metaArr = [];
        metaTags.forEach((metaTag, i) => {
            let attributes=[...metaTag[0].matchAll(attributeRegex)];
            for(let j=0; j<attributes.length; j++) {
                if (attributes[j][4].indexOf(this.openDelimiter)>-1) {
                    metaArr.push({
                        metaNo: i,
                        attributeNo: j,
                        nodeName: attributes[j][1],
                        nodeValue: attributes[j][4]
                    })
                }
            }
        });
        this.metaArray = JSON.parse(JSON.stringify(metaArr));
        return;
    }

    async changeCss(newHTML) {
        // remove comment
        newHTML = this.removeComment(newHTML);
        // combine css in style tag and linked css
        let combinedStyle = await this.combineCss(newHTML);
        return combinedStyle;
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
            if (linkHref.indexOf("http")<0) urls.push(new URL(linkHref, relUrl).href);
        });

        // read and combine css files
        let importedStyles = await this.getTextFromFiles(urls);
        let relativeUrls = [];
        urls.forEach(url => {
            relativeUrls.push(this.getComparedPath(url, this.currentUrl().host));
        })
        for (let i=0; i<importedStyles.length; i++) {
            importedStyles[i] = this.replaceRelativeUrl(importedStyles[i], relativeUrls[i]);
        }
        combinedStyle = importedStyles.reduce((acc, style) => {
            return acc + style;
        }, combinedStyle);
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
                if (stdUrl[i] !== '') {
                    added.push("..");
                }
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
                let baseArr = baseUrl.split('/');
                baseArr.pop();
                baseArr.pop();
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
                let baseArr = baseUrl.split('/');
                baseArr.pop();
                baseArr.pop();
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
        if (urls.length == 0) {
            // if there is no @import at all
            finalCSS = codes.join("");
            return finalCSS;
        }
        let insertedCSSs = await this.getTextFromFiles(urls);
        let relativeUrls = [];
        urls.forEach(url => {
            relativeUrls.push(this.getComparedPath(url, this.currentUrl().host));
        })
        for (let i=0; i<insertedCSSs.length; i++) {
            insertedCSSs[i] = this.replaceRelativeUrl(insertedCSSs[i], relativeUrls[i]);
        }        
        // insert CSS of files into each @import
        insertedCSSs.forEach((insertedCSS, i) => {
            codes[orders[i]] = (media[i] !== "") ? this.insertMedia(insertedCSS, media[i]) : insertedCSS;
        });
        // new CSS with imported CSS
        finalCSS = codes.join("");
        // recursively insert css from imported css files
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

    currentUrl() {
        let fullUrl = this.url;
        let fileName = fullUrl.split("/").pop();
        let host = fullUrl.substring(0, fullUrl.length - fileName.length); // host + path (without filename)
        return { host: host, filename: fileName };
    }

    async getTextFromFiles(urls) {
        if (urls.length == 0)
            return [];
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
        errorNo.map((err) => insertedTexts.splice(err, 0, "error: check your path"));
        return insertedTexts;
    }

    removeComment(html) {
        const commentRegex = /<!--[\s\S]*?-->/gm;
        return html.replace(commentRegex, '');
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

onmessage = (e) => {
    let result = {};
    let url = e.data.path;
    let scope = e.data.scope;
    const mworker = new myWorker();

    const temp = mworker.readFurther(scope, url).then( res => {
        result.fileIncludedHTML = res.fileIncludedHTML;
        result.cssText = res.cssText;
        result.fileName = res.filename;
        result.titleCode = res.titleCode;
        result.metaArray = res.metaArray;
        postMessage(result);
    });
}