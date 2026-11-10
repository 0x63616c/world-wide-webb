import {resolveSearch, fallbackSearch} from "./redirect.js";

const original = location.hash.slice(1);
const destination = resolveSearch(original) ?? fallbackSearch(original);
if (destination) location.replace(destination);
else document.getElementById("status").textContent = "This is not a supported Google search. Enter go/repo in Safari’s address bar.";
