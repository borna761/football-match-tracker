# Football Match Tracker

A Chrome extension that shows upcoming matches for your favorite football teams, inspired by the FotMob mobile widget.

![icon](icons/icon128.png)

## Features

- Upcoming fixtures for followed teams across all major leagues
- Groups matches by date (Today / Tomorrow / date)
- Shows team crests, kick-off times, and competition names
- Live scores and final results
- Follows system dark/light mode
- Caches results for 1 hour to stay within API rate limits

## Teams tracked

Arsenal · Barcelona · Inter Milan · Argentina · Spain · Sweden

## Setup

1. Clone the repo
2. Copy `config.example.js` to `config.js` and add your API key:
   ```js
   const API_KEY = "your_key_here";
   ```
3. Get a free key at [football-data.org](https://www.football-data.org/client/register)
4. Go to `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this folder

## Data source

[football-data.org](https://www.football-data.org) free tier — covers Premier League, La Liga, Serie A, Champions League, World Cup, and more.
