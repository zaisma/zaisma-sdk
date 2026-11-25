# Covers that show your game

The cover guide, also at [zaisma.com/developers/covers](https://zaisma.com/developers/covers) with its pictures (`brand/cover-guide/`). Keep the two in step (`apps/site/src/cover-guide.ts`).

Your cover is your game's card everywhere players browse, shown alone with no title over or under it. Covers and titles keep four lines anyone can check against the picture, and players report one that doesn't. Style is yours: this says what passes, what doesn't, and what the best covers do.

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

The lines every cover, square cover and share picture keeps, the same for every game. No AI reads your pictures: they show once image matching has checked them for known abuse material (`add_image`, then `get_game`), and players report one that breaks a line, for a person at Zaisma to look at.

1. **No text but the title.** The game's name, a subtitle and your studio's logo. No callouts ("NEW LEVELS!"), update banners, feature lists, counts ("100 STAGES"), prices or stats ("+1 JUMP / SEC"). Words that are part of the scene, like a sign on a building, are fine.
2. **Nothing laid over the picture.** No buttons, menus, shop panels, reward rows, badges, stickers, or arrows and circles pointing at things.
3. **No fake rewards.** Nothing promising free Robux, V-Bucks, gift cards or cash, on a cover, any other picture or in the title or description. A title or description with those words is refused when you send it (`fake_reward_words`); a picture with them goes by reports, and a person takes it down.

## Busy and bright is fine

Bright colors, busy art, shocked faces, piles of coins and an AI-made look are never against the lines (`coin-cascade-busy-fine.webp`: loud, and only the title, so it passes). The covers at the top show what tends to work better.

## Your gallery

Your game page's gallery is yours (`add_image` kind `gallery_picture`, up to 8): any picture of the game, made or captured, with or without words on it. Like every picture, it goes by reports: only safety and fake rewards take one down. Tag a capture of the game as it plays Screenshot (`is_screenshot` true), and players see the tag; a player can report a picture tagged Screenshot that isn't one, and an upheld report counts against your account's standing (`screenshot-fine.webp`: a capture, tagged Screenshot; `screenshot-not-fine.webp`: words and arrows over a capture, fine in the gallery without the tag).

## Backgrounds

A background is your game's world behind Zaisma's glass on your game page: a picture, or a shader that paints it live. It's separate from your cover and carries no title, logo or words: those go on the cover. Nothing is laid over it, like a button, badge or sticker. Words that are part of the scene, like a sign on a building, are fine. Compose it for the glass: on a wide screen the game page's glass runs across the middle, up to 1680 px wide, with your world round it and clear on both sides of big screens; on a phone the glass takes the whole width. Spread the interest wide and keep it calm where the glass's words sit. Without a phone background, phones show the wide one. The background guide ([`docs/BACKGROUNDS.md`](BACKGROUNDS.md), also at [zaisma.com/developers/backgrounds](https://zaisma.com/developers/backgrounds)) says what reads well under the glass, with live backgrounds whose sources are open to start from.

## Titles

A title names the game. No tags: a bracketed tag like [UPDATE], an emoji, or NEW, UPDATE or FREE used as a tag. "+1 Speed Run", "Wrangler 2x" and "Free Fall" are names, so they're fine. No list of what the game is: "Car Mechanic Simulator" is a name, however long, and "Neon Rush: Racing Drift Car Driving Simulator" isn't; the description and genres say what it is, and search finds those too. No fake rewards (`fake_reward_words`, refused when sent). Patch notes are where you say what's new.

## What happens

Pictures show as soon as image matching has checked them, and new words at once. No AI judges them: players report a cover, picture or title that breaks a line, and a person at Zaisma decides. A new developer's game reaches Zaisma's lists only once real players have played it for a few quiet days (`is_waiting_for_zaisma_lists`). A title or description promising a fake reward is refused when you send it (`fake_reward_words`, quoting the words). If a person's decision looks wrong, `message_zaisma` with the `game_slug`; a person's decision stands.
