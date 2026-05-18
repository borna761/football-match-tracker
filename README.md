# Football Match Tracker

A Chrome extension that shows upcoming matches for your favorite football teams, inspired by the FotMob mobile widget.

![screenshot](screenshot.png)

## Features

- Upcoming fixtures for your followed teams across all major leagues
- Groups matches by date (Today / Tomorrow / date)
- Shows team crests, kick-off times, and competition names
- Live scores and final results
- Follows system dark/light mode
- Caches results for 1 hour to stay within API rate limits

## Setup

1. Clone the repo
2. Copy `config.example.js` to `config.js` and add your API key:
   ```js
   const API_KEY = "your_key_here";
   ```
3. Get a free key at [football-data.org](https://www.football-data.org/client/register)
4. Go to `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this folder

## Adding your own teams

Open `popup.js` and edit the `TEAMS` array near the top:

```js
const TEAMS = [
  { id: 57,  name: "Arsenal" },
  { id: 81,  name: "Barcelona" },
  // add more teams here...
];
```

To find a team's ID, look it up at [football-data.org/v4/teams](https://api.football-data.org/v4/teams) (requires your API key) or search the [docs](https://docs.football-data.org).

> **Note:** The free tier covers the major European leagues, Champions League, and international tournaments (World Cup, Euros). MLS and some smaller leagues are not available.

## Data source

[football-data.org](https://www.football-data.org) free tier — covers Premier League, La Liga, Serie A, Bundesliga, Champions League, World Cup, and more.
