module.exports = {
    entry: "./src/index.js",
    output: {
        filename: "extension.js",
        path: __dirname,
        library: {
            type: "module",
        },
    },
    mode: "production",
    experiments: {
        outputModule: true,
    },
    performance: {
        hints: false,
    },
};
