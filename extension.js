var parentUid = undefined;
let hashChange = undefined;
let observer = undefined;
let tocShowing = false;
var h4Tag, h5Tag, h6Tag;

export default {
    onload: ({ extensionAPI }) => {
        extensionAPI.ui.commandPalette.addCommand({
            label: "Create a Table of Contents (toc)",
            callback: () => createTOC()
        });

        async function initiateObserver() {
            const targetNode1 = document.getElementsByClassName("rm-topbar")[0];
            const config = { attributes: false, childList: true, subtree: true };
            const callback = function (mutationsList, observer) {
                for (const mutation of mutationsList) {
                    if (mutation.addedNodes[0]) {
                        for (var i = 0; i < mutation.addedNodes[0]?.classList.length; i++) {
                            if (mutation.addedNodes[0]?.classList[i] == "rm-open-left-sidebar-btn") { // left sidebar has been closed
                                createMenuDiv();
                            }
                        }
                    } else if (mutation.removedNodes[0]) {
                        for (var i = 0; i < mutation.removedNodes[0]?.classList.length; i++) {
                            if (mutation.removedNodes[0]?.classList[i] == "rm-open-left-sidebar-btn") { // left sidebar has been opened
                                createMenuDiv();
                            }
                        }
                    }
                }
            };
            observer = new MutationObserver(callback);
            observer.observe(targetNode1, config);
        }
        initiateObserver();
        createMenuDiv(); // onload

        async function createMenuDiv() {
            if (document.getElementById("tableOfContents")) {
                document.getElementById("tableOfContents").remove();
            }
            var div = document.createElement('div');
            div.classList.add('flex-items');
            div.innerHTML = "";
            div.id = 'tableOfContents';
            div.onclick = toggleTOC;
            var span = document.createElement('span');
            span.classList.add('bp3-button', 'bp3-minimal', 'bp3-small', 'bp3-icon-properties');
            div.prepend(span);

            if (document.querySelector(".rm-open-left-sidebar-btn")) {
                await sleep(30);
                if (document.querySelector("#workspaces")) { // Workspaces extension also installed, so place this to right
                    let workspaces = document.querySelector("#workspaces");
                    workspaces.after(div);
                } else if (document.querySelector("#todayTomorrow")) { // Today Tomorrow extension also installed, so place this to right
                    let todayTomorrow = document.querySelector("#todayTomorrow");
                    todayTomorrow.after(div);
                } else if (document.querySelector("span.bp3-button.bp3-minimal.bp3-icon-arrow-right.pointer.bp3-small.rm-electron-nav-forward-btn")) { // on Electron, place this to the right
                    let electronArrows = document.getElementsByClassName("rm-electron-nav-forward-btn")[0];
                    electronArrows.after(div);
                } else {
                    let sidebarButton = document.querySelector(".rm-open-left-sidebar-btn");
                    sidebarButton.after(div);
                }
            } else {
                await sleep(30);
                if (document.querySelector("#workspaces")) { // Workspaces extension also installed, so place this to right
                    let workspaces = document.querySelector("#workspaces");
                    workspaces.after(div);
                } else if (document.querySelector("#todayTomorrow")) { // Today Tomorrow extension also installed, so place this to right
                    let todayTomorrow = document.querySelector("#todayTomorrow");
                    todayTomorrow.after(div);
                } else if (document.querySelector("span.bp3-button.bp3-minimal.bp3-icon-arrow-right.pointer.bp3-small.rm-electron-nav-forward-btn")) { // on Electron, place this to the right
                    let electronArrows = document.getElementsByClassName("rm-electron-nav-forward-btn")[0];
                    electronArrows.after(div);
                } else {
                    var topBarContent = document.querySelector("#app > div > div > div.flex-h-box > div.roam-main > div.rm-files-dropzone > div");
                    var topBarRow = topBarContent.childNodes[1];
                    topBarRow.parentNode.insertBefore(div, topBarRow);
                }
            }
        }
    },
    onunload: () => {
        if (document.getElementById("toc")) {
            document.getElementById("toc").remove();
        }
        if (document.getElementById("tableOfContents")) {
            document.getElementById("tableOfContents").remove();
        }
        window.roamAlphaAPI.data.removePullWatch(
            "[:block/children :block/heading {:block/children ...}]",
            `[:block/uid "${parentUid}"]`,
            pullFunction);
    }
}

async function createTOC() {
    parentUid = await window.roamAlphaAPI.ui.mainWindow.getOpenPageOrBlockUid();
    if (parentUid == null) { // check for log page
        var uri = window.location.href;
        const regex = /^https:\/\/roamresearch.com\/.+\/(app|offline)\/\w+$/; // log page
        if (regex.test(uri)) { // definitely a log page, so get the corresponding page uid
            var today = new Date();
            var dd = String(today.getDate()).padStart(2, '0');
            var mm = String(today.getMonth() + 1).padStart(2, '0');
            var yyyy = today.getFullYear();
            parentUid = mm + '-' + dd + '-' + yyyy;
        }
    }

    await window.roamAlphaAPI.data.addPullWatch(
        "[:block/children :block/heading :block/string {:block/children ...}]",
        `[:block/uid "${parentUid}"]`,
        pullFunction);

    let blocks = await getTreeByParentUid(parentUid);
    if (blocks != undefined) {
        var headings = [];
        var divParent, appBG, comph1, comph2, comph3;
        var cssString = "";

        const app = document.querySelector(".roam-body .roam-app");
        const compApp = window.getComputedStyle(app);
        let tocTopMargin = 125 - parseInt(compApp["height"]);
        console.info(compApp["backgroundColor"]);
        if (compApp["backgroundColor"] == "rgba(0, 0, 0, 0)") {
            appBG = "white";
            cssString += ".toc-container {background-color: " + appBG + " !important; top: " + tocTopMargin + "px !important;} ";
        } else {
            var R, G, B, A;
            var colours = compApp["backgroundColor"].split("(")[1];
            colours = colours.split(",");
            R = colours[0].trim();
            G = colours[1].trim();
            B = colours[2].trim();
            B = B.split(")")[0];
            if (colours.length == 3) {
                A = 0;
            } else {
                A = colours[4];
            }

            const brightness = R * 0.299 + G * 0.587 + B * 0.114 + ((1 - A) * 255);
            appBG = RGBAToHexA(compApp["backgroundColor"], true);
            if (brightness > 186) {
                cssString += ".toc-container {background-color: " + appBG + " !important; filter: brightness(85%); top: " + tocTopMargin + "px !important;} ";
            } else {
                cssString += ".toc-container {background-color: " + appBG + " !important; top: " + tocTopMargin + "px !important;} ";
            }
        }
        if (document.querySelector(".rm-heading-level-1>.rm-block__self .rm-block__input")) {
            const h1 = document.querySelector(".rm-heading-level-1>.rm-block__self .rm-block__input");
            comph1 = window.getComputedStyle(h1);
            var h1_size = comph1["fontSize"];
            var h1_weight = comph1["fontWeight"];
            var h1_color = comph1["color"];
            cssString += ".toc-1 {font-size: " + h1_size + " !important; font-weight: " + h1_weight + " !important; color: " + h1_color + " !important;} ";
        }
        if (document.querySelector(".rm-heading-level-2>.rm-block__self .rm-block__input")) {
            const h2 = document.querySelector(".rm-heading-level-2>.rm-block__self .rm-block__input");
            comph2 = window.getComputedStyle(h2);
            var h2_size = comph2["fontSize"];
            var h2_weight = comph2["fontWeight"];
            var h2_color = comph2["color"];
            cssString += ".toc-2 {font-size: " + h2_size + " !important; font-weight: " + h2_weight + " !important; color: " + h2_color + " !important;} ";
        }
        if (document.querySelector(".rm-heading-level-3>.rm-block__self .rm-block__input")) {
            const h3 = document.querySelector(".rm-heading-level-3>.rm-block__self .rm-block__input");
            comph3 = window.getComputedStyle(h3);
            var h3_size = comph3["fontSize"];
            var h3_weight = comph3["fontWeight"];
            var h3_color = comph3["color"];
            cssString += ".toc-3 {font-size: " + h3_size + " !important; font-weight: " + h3_weight + " !important; color: " + h3_color + " !important;} ";
        }
        if (localStorage.getItem("augmented_headings:h4")) {
            h4Tag = localStorage.getItem("augmented_headings:h4");
            if (document.querySelector("[data-tag^='" + h4Tag + "'] + .rm-highlight")) {
                const h4 = document.querySelector("[data-tag^='" + h4Tag + "'] + .rm-highlight");
                var comph4 = window.getComputedStyle(h4);
                var h4_size = comph4["fontSize"];
                var h4_weight = comph4["fontWeight"];
                var h4_color = comph4["color"];
                var h4_style = comph4["font-style"];
                var h4_variant = comph4["font-variant"];
                cssString += ".toc-4 {font-size: " + h4_size + " !important; font-weight: " + h4_weight + " !important; color: " + h4_color + " !important; font-style: " + h4_style + " !important; font-variant: " + h4_variant + " !important;} ";
            }
        }
        if (localStorage.getItem("augmented_headings:h5")) {
            h5Tag = localStorage.getItem("augmented_headings:h5");
            if (document.querySelector("[data-tag^='" + h5Tag + "'] + .rm-highlight")) {
                const h5 = document.querySelector("[data-tag^='" + h5Tag + "'] + .rm-highlight");
                var comph5 = window.getComputedStyle(h5);
                var h5_size = comph5["fontSize"];
                var h5_weight = comph5["fontWeight"];
                var h5_color = comph5["color"];
                var h5_style = comph5["font-style"];
                var h5_variant = comph5["font-variant"];
                cssString += ".toc-5 {font-size: " + h5_size + " !important; font-weight: " + h5_weight + " !important; color: " + h5_color + " !important; font-style: " + h5_style + " !important; font-variant: " + h5_variant + " !important;} ";
            }
        }
        if (localStorage.getItem("augmented_headings:h6")) {
            h6Tag = localStorage.getItem("augmented_headings:h6");
            if (document.querySelector("[data-tag^='" + h6Tag + "'] + .rm-highlight")) {
                const h6 = document.querySelector("[data-tag^='" + h6Tag + "'] + .rm-highlight");
                var comph6 = window.getComputedStyle(h6);
                var h6_size = comph6["fontSize"];
                var h6_weight = comph6["fontWeight"];
                var h6_color = comph6["color"];
                var h6_style = comph6["font-style"];
                var h6_variant = comph6["font-variant"];
                cssString += ".toc-6 {font-size: " + h6_size + " !important; font-weight: " + h6_weight + " !important; color: " + h6_color + " !important; font-style: " + h6_style + " !important; font-variant: " + h6_variant + " !important;} ";
            }
        }

        var head = document.getElementsByTagName("head")[0]; // remove any existing toc styles and add updated styles
        if (document.getElementById("toc-css")) {
            var cssStyles = document.getElementById("toc-css");
            head.removeChild(cssStyles);
        }
        var style = document.createElement("style");
        style.id = "toc-css";
        style.textContent = cssString;
        head.appendChild(style);

        traverseTree(blocks).then(async () => {
            if (document.getElementById("toc")) {
                document.getElementById("toc").remove();
            }
            if (headings.length > 0) {
                let button = document.getElementById("tableOfContents"); // set background on button
                button.style.backgroundColor = "#15e891";
                button.style.borderRadius = "5px";

                divParent = document.createElement('div'); // create a toc div
                divParent.classList.add('toc-container');
                divParent.innerHTML = "";
                divParent.id = 'toc';

                for (var i = 0; i < headings.length; i++) { // iterate through headings and create divs in toc
                    console.info(headings[i]);
                    if (!headings[i].text.startsWith("${{calc")) {
                        var newDiv = document.createElement('div');
                        let tocLevel = "toc-" + headings[i].heading.toString();
                        newDiv.classList.add(tocLevel);
    
                        let headingText = headings[i].text.replaceAll("**", ""); // strip markdown from headings
                        headingText = headingText.replaceAll("__", "");
                        headingText = headingText.replaceAll("::", "");
                        const regex = /^#(h\d)\^\^(.+)\^\^$/; // check for H4-H6 heading code
                        if (regex.test(headingText)) {
                            const array = [...headingText.match(regex)];
                            headingText = array[2];
                        }
                        newDiv.innerHTML = headingText;
                        newDiv.id = "toc" + i;
                        let uid = headings[i].uid;
                        newDiv.onclick = (e) => scrollTo(e, uid);
                        divParent.append(newDiv);
                    }
                }

                let mainRoam = document.querySelector("div.roam-body-main"); // insert div in DOM
                let position = mainRoam.childNodes[0];
                position.after(divParent);

                hashChange = async (e) => { // remove toc if change page
                    if (document.getElementById("toc")) {
                        document.getElementById("toc").remove();
                    }
                    let button = document.getElementById("tableOfContents"); // unset background on button
                    button.style.backgroundColor = "";
                    button.style.borderRadius = "";
                    await window.roamAlphaAPI.data.removePullWatch(
                        "[:block/children :block/heading :block/string {:block/children ...}]",
                        `[:block/uid "${parentUid}"]`,
                        pullFunction);

                    tocShowing = false;
                    window.removeEventListener('hashchange', hashChange); // remove listener if change page
                };
                window.addEventListener('hashchange', hashChange);
                tocShowing = true;
            } else {
                if (document.getElementById("toc")) {
                    document.getElementById("toc").remove();
                }
                let button = document.getElementById("tableOfContents"); // unset background on button
                button.style.backgroundColor = "";
                button.style.borderRadius = "";
                await window.roamAlphaAPI.data.removePullWatch(
                    "[:block/children :block/heading :block/string {:block/children ...}]",
                    `[:block/uid "${parentUid}"]`,
                    pullFunction);
                if (tocShowing == false) {
                    alert("There are no headings on this page!");
                }
                tocShowing = false;
            }
        });

        async function traverseTree(blocks) {
            const regex = /^#h(\d)\^\^(.+)\^\^$/;
            blocks.map((x) => {
                if ((x.hasOwnProperty("heading") && x.heading != 0)) { // RR native headings
                    headings.push({ text: x.string, heading: x.heading, uid: x.uid })
                } else if (localStorage.getItem("augmented_headings:h4")) { // Augmented headings
                    if (h4Tag != undefined && x.string.match(h4Tag)) {
                        var newString = x.string.replace("#" + h4Tag + "", "");
                        newString = newString.replaceAll("^^", "");
                        headings.push({ text: newString, heading: parseInt(4), uid: x.uid })
                    } else if (h5Tag != undefined && x.string.match(h5Tag)) {
                        var newString = x.string.replace("#" + h5Tag + "", "");
                        newString = newString.replaceAll("^^", "");
                        headings.push({ text: newString, heading: parseInt(5), uid: x.uid })
                    } else if (h6Tag != undefined && x.string.match(h6Tag)) {
                        var newString = x.string.replace("#" + h6Tag + "", "");
                        newString = newString.replaceAll("^^", "");
                        headings.push({ text: newString, heading: parseInt(6), uid: x.uid })
                    }
                }
                if (x.hasOwnProperty("children")) {
                    sortObjectsByOrder(x.children);
                    traverseTree(x.children);
                }
            });
        }
    } else {
        if (document.getElementById("toc")) {
            document.getElementById("toc").remove();
        }
        let button = document.getElementById("tableOfContents"); // unset background on button
        button.style.backgroundColor = "";
        button.style.borderRadius = "";
        await window.roamAlphaAPI.data.removePullWatch(
            "[:block/children :block/heading :block/string {:block/children ...}]",
            `[:block/uid "${parentUid}"]`,
            pullFunction);
        alert("There are no headings on this page!");
        tocShowing = false;
    }
}

async function pullFunction(before, after) {
    await sleep(50);
    if (tocShowing == true) {
        createTOC();
    }
}

async function toggleTOC() {
    if (tocShowing == true) {
        if (document.getElementById("toc")) {
            document.getElementById("toc").remove();
        }
        let button = document.getElementById("tableOfContents"); // unset background on button
        button.style.backgroundColor = "";
        button.style.borderRadius = "";
        await window.roamAlphaAPI.data.removePullWatch(
            "[:block/children :block/heading :block/string {:block/children ...}]",
            `[:block/uid "${parentUid}"]`,
            pullFunction);

        tocShowing = false;
    } else {
        createTOC();
    }
}

async function scrollTo(e, uid) {
    let q = `[:find (pull ?page [:block/string :block/uid :block/open :block/order {:block/parents ...}]) :where [?page :block/uid "${uid}"]]`;
    var results = await window.roamAlphaAPI.q(q);
    if (results[0][0].parents.length > 0) {
        for (var i = 0; i < results[0][0].parents.length; i++) {
            if (results[0][0].parents[i].open == false) {
                window.roamAlphaAPI.updateBlock({ block: { uid: results[0][0].parents[i].uid, open: true } }); // open the block so the div for this uid is in the DOM
            }
        }
    }
    await sleep(50);
    var shiftButton = false;
    if (e.shiftKey) {
        shiftButton = true;
    }
    if (shiftButton == false) {
        const target = document.querySelector('[id*="' + uid + '"]');
        target.scrollIntoView({ behavior: "smooth" });
    } else {
        await window.roamAlphaAPI.ui.rightSidebar.open();
        await window.roamAlphaAPI.ui.rightSidebar.addWindow({ window: { type: 'outline', 'block-uid': uid } });
    }
}

// modified from David Vargas' code at https://github.com/dvargas92495/roam-client/blob/main/src/queries.ts#L449
async function getTreeByParentUid(uid) {
    let tree = await window.roamAlphaAPI.q(
        `[:find (pull ?b [
        :block/string
        :block/uid 
        :block/order 
        :block/heading
        {:block/children ...}
      ]) :where [?b :block/uid "${uid}"]]`)[0][0].children;
    if (tree != undefined) {
        tree = await sortObjectsByOrder(tree);
        return tree;
    }
};

// helper functions
async function sortObjectsByOrder(o) {
    return o.sort(function (a, b) {
        return a.order - b.order;
    });
}

function RGBAToHexA(rgba, forceRemoveAlpha) { // courtesy of Lars Flieger at https://stackoverflow.com/questions/49974145/how-to-convert-rgba-to-hex-color-code-using-javascript
    return "#" + rgba.replace(/^rgba?\(|\s+|\)$/g, '') // Gets rgba / rgb string values
        .split(',') // splits them at ","
        .filter((string, index) => !forceRemoveAlpha || index !== 3)
        .map(string => parseFloat(string)) // Converts them to numbers
        .map((number, index) => index === 3 ? Math.round(number * 255) : number) // Converts alpha to 255 number
        .map(number => number.toString(16)) // Converts numbers to hex
        .map(string => string.length === 1 ? "0" + string : string) // Adds 0 when length of one number is 1
        .join("") // Puts the array to together to a string
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}