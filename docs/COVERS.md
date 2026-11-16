# Covers that show your game

The cover guide, also at [zaisma.com/developers/covers](https://zaisma.com/developers/covers) with its pictures (`brand/cover-guide/`). Keep the two in step (`apps/site/src/cover-guide.ts`).

Your cover is your game's card everywhere players browse, shown alone with no title over or under it. Zaisma's lists (home, All games, browse and search engines) show games whose covers and titles keep four lines anyone can check against the picture. Style is yours: this says what passes, what doesn't, and what the best covers do.

## Sizes

Each picture's shape and size, set from where Zaisma draws it largest: the home's Your game card draws a cover over 1,000 px wide on a big screen, twice that on a sharp one.

- **Cover:** landscape, 16:9 shows best; 2560 by 1440 px shows sharp on the largest screens, at least 1280 by 720 px.
- **Square cover:** as wide as it is tall; 1024 by 1024 px shows sharp on the largest screens, at least 512 by 512 px.
- **Gallery picture:** any picture of the game, landscape or portrait; 2560 by 1440 px shows sharp on the largest screens, at least 1280 by 720 px.
- **Share picture:** landscape, as a chat unfolds a link; 1200 by 630 px shows sharp on the largest screens, at least 600 by 315 px.

PNG, JPEG or WebP, up to 10 MB. `preview_game_page`, and the dashboard's preview beside Images, show yours in place on a laptop and a phone before you send it.

## Show your game well

Whatever the game, from painted PC-scale art to a blocky battleground, great covers do the same five things:

1. One subject from the game, big.
2. The game's name, big enough to read on a phone.
3. The game's own art and colors.
4. A simple background, with room around the subject.
5. Still clear as a small card.

The page shows them with `emberfall-painted.webp` (painted like a PC store's art: one knight, big, and the name), `brick-brawl-blocky.webp` (a blocky battleground: its fighters, bright colors and a name that reads small), and Zaisma's demo games with real captures and their names: `good-four-in-a-row.webp` (a real board from the game) and `good-arena.webp` (the game's own arena). Browsers run games as big as PC games now, so aim for their art: a cover that would sit well on a PC store, not one made for a quick mobile game. Study these on their store pages: [Hades](https://store.steampowered.com/app/1145360/Hades/), [Hollow Knight](https://store.steampowered.com/app/367520/Hollow_Knight/), [Celeste](https://store.steampowered.com/app/504230/Celeste/), [Octopath Traveler](https://store.steampowered.com/app/921570/OCTOPATH_TRAVELER/), [Dead Cells](https://store.steampowered.com/app/588650/Dead_Cells/) and [Balatro](https://store.steampowered.com/app/2379780/Balatro/).

## The four lines

An AI checks every cover, square cover and share picture in about a minute (`add_image`, then `get_game`). These are the lines it holds them to, the same for every game. Each code is the image's `listing_reason`.

1. **No text but the title** (`extra_text_on_cover`). The game's name, a subtitle and your studio's logo. No callouts ("NEW LEVELS!"), update banners, feature lists, counts ("100 STAGES"), prices or stats ("+1 JUMP / SEC"). Words that are part of the scene, like a sign on a building, are fine.
2. **Nothing laid over the picture** (`overlay_on_cover`). No buttons, menus, shop panels, reward rows, badges, stickers, or arrows and circles pointing at things.
3. **No fake rewards** (`fake_reward`). Nothing promising free Robux, V-Bucks, gift cards or cash, on a cover, any other picture or in the title or description. This one holds the game until a person looks.

## Busy and bright is fine

Bright colors, busy art, shocked faces, piles of coins and an AI-made look are never against the lines (`coin-cascade-busy-fine.webp`: loud, and only the title, so it passes). The covers at the top show what tends to work better.

## Your gallery

Your game page's gallery is yours (`add_image` kind `gallery_picture`, up to 8): any picture of the game, made or captured, with or without words on it. It's held only for safety and fake rewards, like every picture. Tag a capture of the game as it plays Screenshot (`is_screenshot` true), and players see the tag; a player can report a picture tagged Screenshot that isn't one, and an upheld report counts against your account's standing (`screenshot-fine.webp`: a capture, tagged Screenshot; `screenshot-not-fine.webp`: words and arrows over a capture, fine in the gallery without the tag).

## Backgrounds

A background is your game's world behind Zaisma's glass on your game page: a picture, or a shader that paints it live. It's separate from your cover and carries no title, logo or words: those go on the cover (`text_on_background`, and it doesn't show). Nothing is laid over it, like a button, badge or sticker (`overlay_on_background`). Words that are part of the scene, like a sign on a building, are fine. Compose it for the glass: on a wide screen the game page's glass runs across the middle, up to 1680 px wide, with your world round it and clear on both sides of big screens; on a phone the glass takes the whole width. Spread the interest wide and keep it calm where the glass's words sit. Without a phone background, phones show the wide one. The background guide ([`docs/BACKGROUNDS.md`](BACKGROUNDS.md), also at [zaisma.com/developers/backgrounds](https://zaisma.com/developers/backgrounds)) says what reads well under the glass, with live backgrounds whose sources are open to start from.

## Titles

A title names the game. No tags (`tag_in_title`): a bracketed tag like [UPDATE], an emoji, or NEW, UPDATE or FREE used as a tag. "+1 Speed Run", "Wrangler 2x" and "Free Fall" are names, so they're fine. No list of what the game is (`search_words_in_title`): "Car Mechanic Simulator" is a name, however long, and "Neon Rush: Racing Drift Car Driving Simulator" isn't; the description and genres say what it is, and search finds those too. No fake rewards (`fake_reward`). Patch notes are where you say what's new.

## What happens

Pictures and new words are checked in about a minute. A cover or title that breaks a line still shows on the game's page, and the game plays by its link, but Zaisma's lists leave it out until it's fixed (the `game_off_lists` alert, each image's `listing_reason` and the game's `title_listing_reason` say what and how); it's back about a minute after. A fake reward holds the game until a person looks. If the check got something wrong, `message_zaisma` with the `game_slug`, and a person looks; a person's decision stands.
