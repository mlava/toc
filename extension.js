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
    var divParent;

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
    target.scrollIntoView({behavior: "smooth"});
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