// Smoke-test script for the desktop skills runtime.
const target = process.argv[1] || "world";
console.log("hello, " + target + "!");
console.log("argv:", JSON.stringify(process.argv.slice(1)));
