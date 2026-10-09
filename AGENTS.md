When making visual changes, capture representative screenshots of the running app and include them in the final response so the user can see the changes. Show the relevant states, such as scene transitions, rather than only describing them. Save the screenshots and embed them with Markdown image links.

The game does not have to be mobile compatible. Target desktop browsers only; there is no need to support touch input or small mobile viewports.

When running the game for testing or screenshots, always open it with the `?silent` query parameter (for example `http://localhost:5173/?silent`) so no audio plays. Browsers that report `navigator.webdriver` are silenced automatically.
