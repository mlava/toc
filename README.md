If you do a lot of long-form writing (or reading) in Roam Research, you've probably always wanted this extension: Table of Contents.

**NEW:**
- compatible with Roam Research Hotkeys
- Updated to work together with Augmented Headings extension to allow H4-H6 level headings

You can trigger this extension by opening the Command Palette and choosing 'Create a Table of Contents (toc)'. You could also click the icon in the Roam topbar at top left as shown below. The extension will scan your page for all of your headings and create a floating, sticky Table of Contents to the right of your page.

![image](https://user-images.githubusercontent.com/6857790/209426667-006486e4-a818-4e24-8994-424d41226f85.png)

Clicking on any of the headings in the TOC will scroll your page to that heading. Alternatively, if you hold shift while clicking on the TOC heading it will open that heading block in your right sidebar.

![toc](https://user-images.githubusercontent.com/6857790/204086802-28cd5b53-f64e-40b9-a3c0-17c8e93a4b44.gif)

As you can see in the gif, if you add or remove any headings, the TOC will be automatically updated. The same applies if you change from H1 to H2 and so on. If you navigate to a new page in your graph, the TOC will be removed. (You will need to re-create the TOC if you return to your page and still need it.)

If you open the right sidebar, the TOC will move left so that it doesn't obstruct the sidebar content.

TODO:
1. explore whether creating a TOC for a page can be persisted so that you don't need to re-create it if you go back to that page.
2. ~~configure TOC css to respect the css of any themes applied to your graph, including Roam Studio (just refresh the TOC by using the Command Palette)~~
3. ~~implement shift-click to open heading block in right sidebar rather than scrolling to content~~
4. ~~make the topbar button a toggle to show or hide the TOC~~
5. ~~automatically open any closed headings before attempting to scroll, to make sure there aren't errors~~
