var parentUid = undefined;
let hashChange = undefined;

export default {
    onload: ({ extensionAPI }) => {
        window.roamAlphaAPI.ui.commandPalette.addCommand({
            label: "Create a Table of Contents (toc)",
            callback: () => toc()
        });
    },
    onunload: () => {
        window.roamAlphaAPI.ui.commandPalette.removeCommand({
            label: 'Create a Table of Contents (toc)'
        });
        if (document.getElementById("toc")) {
            document.getElementById("toc").remove();
        }
        window.roamAlphaAPI.data.removePullWatch(
            "[:block/children :block/heading {:block/children ...}]",
            `[:block/uid "${parentUid}"]`,
            pullFunction);
    }
}

async function toc() {
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

    await window.roamAlphaAPI.data.removePullWatch(
        "[:block/children :block/heading {:block/children ...}]",
        `[:block/uid "${parentUid}"]`,
        pullFunction);
    await window.roamAlphaAPI.data.addPullWatch(
        "[:block/children :block/heading {:block/children ...}]",
        `[:block/uid "${parentUid}"]`,
        pullFunction);

    let blocks = await getTreeByParentUid(parentUid);
    var headings = [];
    var divParent, appBG, comph1, comph2, comph3, h1_size, h1_weight, h1_color, h2_size, h2_weight, h2_color, h3_size, h3_weight, h3_color;
    var cssString = "";

    const app = document.querySelector(".roam-body .roam-app");
    const compApp = window.getComputedStyle(app);
    if (compApp["backgroundColor"] == "rgba(0, 0, 0, 0)") {
        appBG = "white";
        cssString += ".toc-container {background-color: "+appBG+" !important;} ";
    } else {
        appBG = RGBAToHexA(compApp["backgroundColor"], true);
        cssString += ".toc-container {background-color: "+appBG+" !important;} ";
    }
    if (document.querySelector(".rm-heading-level-1>.rm-block__self .rm-block__input")) {
        const h1 = document.querySelector(".rm-heading-level-1>.rm-block__self .rm-block__input");
        comph1 = window.getComputedStyle(h1);
        h1_size = comph1["fontSize"];
        h1_weight = comph1["fontWeight"];
        h1_color = comph1["color"];
        console.info(h1_color, h1_size, h1_weight);
        cssString += ".toc-1 {font-size: "+h1_size+" !important; font-weight: "+h1_weight+" !important; color: "+h1_color+" !important;} ";
    }
    if (document.querySelector(".rm-heading-level-2>.rm-block__self .rm-block__input")) {
        const h2 = document.querySelector(".rm-heading-level-2>.rm-block__self .rm-block__input");
        comph2 = window.getComputedStyle(h2);
        h2_size = comph2["fontSize"];
        h2_weight = comph2["fontWeight"];
        h2_color = comph2["color"];
        cssString += ".toc-2 {font-size: "+h2_size+" !important; font-weight: "+h2_weight+" !important; color: "+h2_color+" !important;} ";
    }
    if (document.querySelector(".rm-heading-level-3>.rm-block__self .rm-block__input")) {
        const h3 = document.querySelector(".rm-heading-level-3>.rm-block__self .rm-block__input");
        comph3 = window.getComputedStyle(h3);
        h3_size = comph3["fontSize"];
        h3_weight = comph3["fontWeight"];
        h3_color = comph3["color"];
        cssString += ".toc-3 {font-size: "+h3_size+" !important; font-weight: "+h3_weight+" !important; color: "+h3_color+" !important;} ";
    }
    console.info(cssString);

    var head = document.getElementsByTagName("head")[0];
    if (document.getElementById("toc-css")) {
        var cssStyles = document.getElementById("toc-css");
        head.removeChild(cssStyles);
    }
    var style = document.createElement("style");
    style.id = "toc-css";
    style.textContent = cssString;
    head.appendChild(style);

    traverseTree(blocks).then(async () => {
        if (document.getElementById("toc")) { // empty existing toc
            divParent = document.getElementById("toc");
            divParent.innerHTML = "";
            for (var i = 0; i < headings.length; i++) { // iterate through headings and create divs in toc
                var newDiv = document.createElement('div');
                if (headings[i].heading == 1) {
                    newDiv.classList.add('toc-1');
                } else if (headings[i].heading == 2) {
                    newDiv.classList.add('toc-2');
                } else {
                    newDiv.classList.add('toc-3');
                }
                newDiv.innerHTML = headings[i].text;
                newDiv.id = "toc" + i;
                let uid = headings[i].uid;
                newDiv.onclick = () => scrollTo(uid);
                divParent.append(newDiv);
            }
        } else {
            divParent = document.createElement('div'); // create a toc div
            divParent.classList.add('toc-container');
            divParent.innerHTML = "";
            divParent.id = 'toc';

            for (var i = 0; i < headings.length; i++) { // iterate through headings and create divs in toc
                var newDiv = document.createElement('div');
                if (headings[i].heading == 1) {
                    newDiv.classList.add('toc-1');
                } else if (headings[i].heading == 2) {
                    newDiv.classList.add('toc-2');
                } else {
                    newDiv.classList.add('toc-3');
                }
                newDiv.innerHTML = headings[i].text;
                newDiv.id = "toc" + i;
                let uid = headings[i].uid;
                newDiv.onclick = () => scrollTo(uid);
                divParent.append(newDiv);
            }

            var rightSidebarState = "closed";
            var rightSidebar, rightSidebarPosition;
            if (!document.querySelector("#roam-right-sidebar-content")) {
                await window.roamAlphaAPI.ui.rightSidebar.open();
                await sleep(10);
                rightSidebar = document.querySelector("#right-sidebar");
                rightSidebarPosition = rightSidebar.childNodes[2];
                rightSidebarState = "open";
            } else {
                rightSidebar = document.querySelector("#right-sidebar");
                rightSidebarPosition = rightSidebar.childNodes[2];
            }
            if (rightSidebar && rightSidebarPosition) {
                rightSidebarPosition.parentNode.insertBefore(divParent, rightSidebarPosition);
                if (rightSidebarState == "open") {
                    await window.roamAlphaAPI.ui.rightSidebar.close()
                }
            }
        }

        // adjust placement based on new toc width
        const toc = document.querySelector("#toc");
        const compToc = window.getComputedStyle(toc);
        const tocWidth = compToc["width"];
        let leftMargin = 20 + parseInt(tocWidth);
        toc.style.cssText = 'left: -' + leftMargin + 'px !important;';

        hashChange = async (e) => {
            if (document.getElementById("toc")) {
                document.getElementById("toc").remove();
            }
            window.roamAlphaAPI.data.removePullWatch(
                "[:block/children :block/heading {:block/children ...}]",
                `[:block/uid "${parentUid}"]`,
                pullFunction);

            window.removeEventListener('hashchange', hashChange);
        };
        window.addEventListener('hashchange', hashChange);
    });

    async function traverseTree(blocks) {
        blocks.map((x) => {
            if (x.hasOwnProperty("heading")) {
                headings.push({ text: x.string, heading: x.heading, uid: x.uid })
            }
            if (x.hasOwnProperty("children")) {
                sortObjectsByOrder(x.children);
                traverseTree(x.children);
            }
        });
    }
}

function pullFunction(before, after) {
    toc();
}

function scrollTo(uid) {
    const target = document.querySelector('[id*=' + uid + ']');
    target.scrollIntoView({ behavior: "smooth" });
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
    tree = await sortObjectsByOrder(tree);
    return tree;
};

async function sortObjectsByOrder(o) {
    return o.sort(function (a, b) {
        return a.order - b.order;
    });
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function RGBAToHexA(rgba, forceRemoveAlpha) { // courtesy of Lars Flieger at https://stackoverflow.com/questions/49974145/how-to-convert-rgba-to-hex-color-code-using-javascript
    return "#" + rgba.replace(/^rgba?\(|\s+|\)$/g, '') // Get's rgba / rgb string values
        .split(',') // splits them at ","
        .filter((string, index) => !forceRemoveAlpha || index !== 3)
        .map(string => parseFloat(string)) // Converts them to numbers
        .map((number, index) => index === 3 ? Math.round(number * 255) : number) // Converts alpha to 255 number
        .map(number => number.toString(16)) // Converts numbers to hex
        .map(string => string.length === 1 ? "0" + string : string) // Adds 0 when length of one number is 1
        .join("") // Puts the array to togehter to a string
}