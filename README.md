# Templates for HTML and CSS

* for HTML and Vanilla Javascript
* Simple usage both on HTML and CSS
* Less option settings and no need for complicated useState or useEffect definition
* Immediate state changes with one function call, affect only HTML and CSS part that templates are used in
* Template for variables, template for statements, modules, and nested HTML or CSS files
* Using web-workers for pre-reading and integrating pages for single page rendering through background thread

* This is [demo and detailed documentation](https://ybrians.cafe24.com/etm/)

### TAGS
```
<%    Template tag, for contorl-flow like for-loop, if, select, while, forEach, and so on / no output
<%=   for variables / one line calculation, manipulation of variables that returns value
<%#   component
<%%   Output a literal '<%'
%>    End of tag

    <%  include(' ... path/filename.html ... ') %>
    @import " ... path/filename.css";
```
* templates can be used also in imported css files
* HTML modules, components and CSS files can be nested through multiple levels.

```
    feature.html >  _header.html
                    _main.html >    _main_upper.html
                                    _main_lower.html
```
### EXAMPLE - HTML
```
<div>
    <ul>
        <% data.forEach(function(val){ %>
            <li>
                <%= val %>
            </li>
        <% }) %>
    </ul>
</div>
```
### EXAMPLE - CSS
```
.abc {
    width: <%= abc_width %>px;
    color: <%= abc_color %>px;
}

.def {
    <% if (condition==true) { %>
        color: <%= color1 %>
    <% } else { %>
        color: <%= color2 %>
    <% } %>
}

<% for(let i=1; i<iterateNo+1; i++) { %>
    .added:nth-child(<%= i %>) {
        padding-left: <%= (i*20)+"px" %>;
    }
<% } %>
```
- templates inside _style_ tag or linked CSS files

### eTemplate()
> **declare eTemplate()**

```
const etm = new  eTemplate({
    syncClass: default: "et_sync",
    openDelimiter: default: "<%" | "two characters", 
    closeDelimiter: default: "%>" | "two characters",
    startUrl: default: "index.html"
});
```

#### **Arguments**
* All the arguments are optional.

> **syncClass** : string  `syncClass: default: "et_sync"`
        
* class name to specify elements to be re-rendered when sync() is executed.
* If you omit this, the class name _"et_sync"_ will be added to parent elements of templates or template blocks.
* If there is no parent element, just before the template, _span_ tag will be added as a parent element.
* If you don't want this _span_ tag, surround templates with a tag that you want, such as _div_ tag.
* In case a template is used in the attribute of tag, the class name will be added to the tag, itself.
```
<Input class="et_sync" type="text" value="<%= data%> data-sync="data">
```

> **openDelimiter** : string  `openDelimiter: default: "<%"`
        
* should be two characters that can be easily distinguished from HTML or CSS.
* open delimiter for comment will be set as "openDelimiter"+"%".

> **closeDelimiter** : string  `closeDelimiter: default: "%>"`
        
* should be two characters that can be easily distinguished from HTML or CSS.

> **startUrl** : string  `startUrl: "/about.html"`

* path of html file to render firstly replacing index.html with (optional)
* if syncUrl is omitted in render(), this file would be the first candidate to load.

### render() and parameters
> **Render all the templates in HTML and CSS including html modules and linked CSS files**
    
```
const etm=new eTemplate();

etm.render({
    url: "path", 
    scroll: { id: "id", position: "start | center | end" },
    scope: default: null | "body"
}, callback);
```
> **eTemplate doesn't accept data. Just declare variables which is used in templates before you execute render()**

#### **Arguments**
* All the arguments are optional.

> **url** : string  `url: "/feature.html"`

* path of html file to replace current html with (optional)
* Use this parameter if all the html files are rendered in single page.
* If you omit this, render() find and render start_url, in case there is no start_url it will render current html file.

> **scroll** : object  `scroll: { id: "id", position: "start | center | end" }`

* **id** : id of element to scroll to inside the html file of the second argument, url
* **position** : vertical alignment of the element. One of "start", "center", or "end"
                                                                     
> **scope** : string  `scope: "body"`

* render() finds out linked CSS files and _style_ tags, and check templates inside them. Even though there is no template, all CSS elements have to be checked for templates, and it might takes a bit.
* If there is no template in CSS files, you can reduce a delay by setting this parameter.
* If iscope is set to "body", render() skips checking CSS files.

> **callback** : function

* render() is asynchoronous function that includes file-reading. If something has to be done after rendering is finished, use callback function.
* without option object, you can use it only with callback function. eg. etm.render(callback) or etm.render(()=>{ ... });

### sync()
> refresh all the elements that has templates on current page
      
```
sync("body");
```

* To refresh templates when variables change from click, mouseover, and other events, add this function in the event-handling scripts.

```
   document.querySelector('.btn').addEventListener('click', () => {
      cnt ++;
      etm.sync();
   });
```
      
* It refreshes only templates that contain changed variables, not only **simple values template** but also **if, if else, for, forEach, switch, while.. blocks**.
* HTML elements and CSS styles with template statements will be rendered.

#### **Argument**
* This argument is optional.
    
> **"body"**
      
* If you omit this, sync() will refresh all the templates of HTML and CSS.
* In case there is no template in CSS, you can speed up refereshing templates.

* for more details, visit [demo and detailed documentation](https://ybrians.cafe24.com/etm/)