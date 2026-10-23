/* Built-in apps: one list shared by the Home page (AI [[app: id]] links) and the browser menu
   (Favorites > Built-in apps). Add an app here and it shows up in both. */
(function (root) {
  "use strict";
  root.OASIS_APPS = {
    "mystic-realm": { path: "apps/mystic-realm/index.html", label: "Mystic Realm", emoji: "🔮" },
    "tarot": { path: "apps/mystic-realm/tarot/index.html", label: "Mystic Tarot", emoji: "🔮", group: "Mystic Realm" },
    "horoscope": { path: "apps/mystic-realm/horoscope/index.html", label: "Horoscope", emoji: "♈", group: "Mystic Realm" },
    "numerology": { path: "apps/mystic-realm/numerology/index.html", label: "Numerology", emoji: "🔢", group: "Mystic Realm" },
    "dreams": { path: "apps/mystic-realm/dreams/index.html", label: "Dream Interpreter", emoji: "🌙", group: "Mystic Realm" },
    "iching": { path: "apps/mystic-realm/iching/index.html", label: "I Ching", emoji: "☯️", group: "Mystic Realm" },
    "astrolabe": { path: "apps/mystic-realm/astrolabe/index.html", label: "Astrolabe", emoji: "🪐", group: "Mystic Realm" },
    "astragalomancy": { path: "apps/mystic-realm/astragalomancy/index.html", label: "Astragalomancy", emoji: "🎲", group: "Mystic Realm" },
    "eightball": { path: "apps/mystic-realm/eightball/index.html", label: "Magic 8-Ball", emoji: "🎱", group: "Mystic Realm" },
    "journal": { path: "apps/mystic-realm/journal/index.html", label: "Reading Journal", emoji: "📔", group: "Mystic Realm" },
    "sitting": { path: "apps/mystic-realm/selene/index.html", label: "Private Sitting", emoji: "🕯️", group: "Mystic Realm" },
    "lobby": { path: "apps/lobby/index.html", label: "The Lobby", emoji: "💬" },
    "maze": { path: "apps/maze-madness/index.html", label: "Maze Madness", emoji: "🌀" },
    "chess": { path: "apps/chess/index.html", label: "Chess", emoji: "♟️" },
    "tv": { path: "tv.html", label: "Live TV", emoji: "📺" },
    "slots": { path: "apps/blaze-reels/index.html", label: "Blaze Reels (slot machine)", emoji: "🎰" }
  };
})(typeof window !== "undefined" ? window : this);
