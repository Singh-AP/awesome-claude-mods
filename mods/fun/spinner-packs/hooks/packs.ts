// The word packs, as [while working, after the turn] pairs: the spinner says
// "Plundering…", the line that closes the turn says "Plundered for 1m 3s".

export type Pair = readonly [present: string, past: string | null]

export type Pack = {
  id: string
  emoji: string
  title: string
  words: readonly Pair[]
}

export const PACKS: readonly Pack[] = [
  {
    id: 'pirate',
    emoji: '🏴‍☠️',
    title: 'Pirate',
    words: [
      ['Plundering', 'Plundered'], ['Hoisting the sails', 'Hoisted the sails'], ['Swabbing the deck', 'Swabbed the deck'],
      ['Charting a course', 'Charted a course'], ['Weighing anchor', 'Weighed anchor'], ['Splicing the mainbrace', 'Spliced the mainbrace'],
      ['Keelhauling bugs', 'Keelhauled bugs'], ['Burying treasure', 'Buried treasure'], ['Scanning the horizon', 'Scanned the horizon'],
      ['Raising the Jolly Roger', 'Raised the Jolly Roger'], ['Battening the hatches', 'Battened the hatches'], ['Boarding', 'Boarded'],
      ['Parleying', 'Parleyed'], ['Navigating', 'Navigated'], ['Tacking', 'Tacked'], ['Hauling', 'Hauled'],
      ['Mending the rigging', 'Mended the rigging'], ['Counting doubloons', 'Counted doubloons'], ['Reading the map', 'Read the map'],
      ['Pillaging', 'Pillaged'], ['Sailing', 'Sailed'], ['Dropping anchor', 'Dropped anchor'],
      ["Climbing the crow's nest", "Climbed the crow's nest"], ['Polishing the cannons', 'Polished the cannons'],
      ['Feeding the parrot', 'Fed the parrot'], ['Swashbuckling', 'Swashbuckled'], ['Yo-ho-ho-ing', 'Yo-ho-ho-ed'],
    ],
  },
  {
    id: 'shakespeare',
    emoji: '🎭',
    title: 'Shakespeare',
    words: [
      ['Pondering', 'Pondered'], ['Soliloquizing', 'Soliloquized'], ['Musing', 'Mused'], ['Contemplating', 'Contemplated'],
      ['Versifying', 'Versified'], ['Declaiming', 'Declaimed'], ['Brooding', 'Brooded'], ['Rehearsing', 'Rehearsed'],
      ['Composing a sonnet', 'Composed a sonnet'], ['Scheming', 'Schemed'], ['Lamenting', 'Lamented'], ['Beseeching', 'Beseeched'],
      ['Proclaiming', 'Proclaimed'], ['Quilling', 'Quilled'], ['Wooing', 'Wooed'], ['Plotting', 'Plotted'],
      ['Exeunting', 'Exeunted'], ['Perchancing', 'Perchanced'], ['Dreaming, perchance', 'Dreamt, perchance'],
      ['Taking arms', 'Took arms'], ['Treading the boards', 'Trod the boards'], ['Scanning the meter', 'Scanned the meter'],
      ['Consulting the witches', 'Consulted the witches'], ['Holding the mirror up', 'Held the mirror up'],
      ['Mustering', 'Mustered'], ['Bestirring', 'Bestirred'], ['Forswearing', 'Forswore'],
    ],
  },
  {
    id: 'corporate',
    emoji: '💼',
    title: 'Corporate',
    words: [
      ['Synergizing', 'Synergized'], ['Circling back', 'Circled back'], ['Aligning stakeholders', 'Aligned stakeholders'],
      ['Leveraging', 'Leveraged'], ['Ideating', 'Ideated'], ['Actioning', 'Actioned'], ['Deep-diving', 'Deep-dived'],
      ['Moving the needle', 'Moved the needle'], ['Boiling the ocean', 'Boiled the ocean'], ['Taking it offline', 'Took it offline'],
      ['Touching base', 'Touched base'], ['Pivoting', 'Pivoted'], ['Socializing the deck', 'Socialized the deck'],
      ['Right-sizing', 'Right-sized'], ['Operationalizing', 'Operationalized'], ['Unpacking', 'Unpacked'],
      ['Double-clicking', 'Double-clicked'], ['Parking it', 'Parked it'], ['Level-setting', 'Level-set'],
      ['Optimizing synergies', 'Optimized synergies'], ['Drafting the roadmap', 'Drafted the roadmap'],
      ['Scheduling a sync', 'Scheduled a sync'], ['Picking low-hanging fruit', 'Picked low-hanging fruit'],
      ['Running it up the flagpole', 'Ran it up the flagpole'], ['Blue-sky thinking', 'Blue-sky thought'],
      ['Shifting paradigms', 'Shifted paradigms'], ['Adding value', 'Added value'],
    ],
  },
  {
    id: 'wizard',
    emoji: '🧙',
    title: 'Wizard',
    words: [
      ['Conjuring', 'Conjured'], ['Enchanting', 'Enchanted'], ['Transmuting', 'Transmuted'], ['Brewing potions', 'Brewed potions'],
      ['Scrying', 'Scried'], ['Summoning', 'Summoned'], ['Invoking', 'Invoked'], ['Spellcasting', 'Spellcast'],
      ['Consulting the grimoire', 'Consulted the grimoire'], ['Charging the staff', 'Charged the staff'],
      ['Reading the runes', 'Read the runes'], ['Warding', 'Warded'], ['Divining', 'Divined'], ['Levitating', 'Levitated'],
      ['Polishing the orb', 'Polished the orb'], ['Stirring the cauldron', 'Stirred the cauldron'], ['Hexing bugs', 'Hexed bugs'],
      ['Dispelling', 'Dispelled'], ['Channeling mana', 'Channeled mana'], ['Inscribing glyphs', 'Inscribed glyphs'],
      ['Bewitching', 'Bewitched'], ['Alchemizing', 'Alchemized'], ['Gazing at the stars', 'Gazed at the stars'],
      ['Whispering incantations', 'Whispered incantations'], ['Feeding the familiar', 'Fed the familiar'],
      ['Tracing sigils', 'Traced sigils'], ['Opening a portal', 'Opened a portal'],
    ],
  },
  {
    id: 'chef',
    emoji: '👩‍🍳',
    title: 'Chef',
    words: [
      ['Simmering', 'Simmered'], ['Whisking', 'Whisked'], ['Braising', 'Braised'], ['Julienning', 'Julienned'],
      ['Marinating', 'Marinated'], ['Kneading', 'Kneaded'], ['Flambéing', 'Flambéed'], ['Deglazing', 'Deglazed'],
      ['Reducing', 'Reduced'], ['Plating', 'Plated'], ['Seasoning', 'Seasoned'], ['Proofing the dough', 'Proofed the dough'],
      ['Folding', 'Folded'], ['Basting', 'Basted'], ['Caramelizing', 'Caramelized'], ['Blanching', 'Blanched'],
      ['Emulsifying', 'Emulsified'], ['Tasting', 'Tasted'], ['Prepping the mise en place', 'Prepped the mise en place'],
      ['Zesting', 'Zested'], ['Searing', 'Seared'], ['Glazing', 'Glazed'], ['Garnishing', 'Garnished'],
      ['Tempering chocolate', 'Tempered chocolate'], ['Slow-roasting', 'Slow-roasted'], ['Fermenting', 'Fermented'],
      ['Sharpening knives', 'Sharpened knives'],
    ],
  },
  {
    id: 'space',
    emoji: '🚀',
    title: 'Space',
    words: [
      ['Launching', 'Launched'], ['Orbiting', 'Orbited'], ['Calibrating thrusters', 'Calibrated thrusters'], ['Docking', 'Docked'],
      ['Warping', 'Warped'], ['Charting stars', 'Charted stars'], ['Counting down', 'Counted down'],
      ['Achieving liftoff', 'Achieved liftoff'], ['Slingshotting', 'Slingshotted'], ['Spacewalking', 'Spacewalked'],
      ['Deploying solar panels', 'Deployed solar panels'], ['Pinging mission control', 'Pinged mission control'],
      ['Re-entering', 'Re-entered'], ['Terraforming', 'Terraformed'], ['Scanning nebulae', 'Scanned nebulae'],
      ['Aligning the dish', 'Aligned the dish'], ['Running telemetry', 'Ran telemetry'], ['Trimming the trajectory', 'Trimmed the trajectory'],
      ['Firing boosters', 'Fired boosters'], ['Mapping craters', 'Mapped craters'], ['Collecting stardust', 'Collected stardust'],
      ['Engaging hyperdrive', 'Engaged hyperdrive'], ['Escaping gravity', 'Escaped gravity'], ['Decoding signals', 'Decoded signals'],
      ['Stargazing', 'Stargazed'], ['Rendezvousing', 'Rendezvoused'], ['Splashing down', 'Splashed down'],
    ],
  },
  {
    id: 'noir',
    emoji: '🕵️',
    title: 'Noir',
    words: [
      ['Sleuthing', 'Sleuthed'], ['Tailing a suspect', 'Tailed a suspect'], ['Dusting for prints', 'Dusted for prints'],
      ['Following leads', 'Followed leads'], ['Working the case', 'Worked the case'], ['Shaking down sources', 'Shook down sources'],
      ['Connecting the dots', 'Connected the dots'], ['Staking out', 'Staked out'], ['Interrogating', 'Interrogated'],
      ['Reading the dossier', 'Read the dossier'], ['Lighting a match', 'Lit a match'], ['Pounding the pavement', 'Pounded the pavement'],
      ['Brooding in the rain', 'Brooded in the rain'], ['Narrating', 'Narrated'], ['Checking alibis', 'Checked alibis'],
      ['Cracking the case', 'Cracked the case'], ['Squinting through blinds', 'Squinted through blinds'],
      ['Calling in a favor', 'Called in a favor'], ['Tipping the fedora', 'Tipped the fedora'], ['Sifting evidence', 'Sifted evidence'],
      ['Pinning the board', 'Pinned the board'], ['Tracing the money', 'Traced the money'],
      ['Rounding up the usual suspects', 'Rounded up the usual suspects'], ['Listening to the jazz', 'Listened to the jazz'],
      ['Smelling a rat', 'Smelled a rat'], ['Closing in', 'Closed in'], ['Filing the report', 'Filed the report'],
    ],
  },
  {
    id: 'genz',
    emoji: '✨',
    title: 'Gen Z',
    words: [
      ['Cooking', 'Cooked'], ['Locking in', 'Locked in'], ['Vibing', 'Vibed'], ['Manifesting', 'Manifested'],
      ['Slaying', 'Slayed'], ['Rizzing up the compiler', 'Rizzed up the compiler'], ['Glowing up', 'Glowed up'],
      ['Understanding the assignment', 'Understood the assignment'], ['Main-charactering', 'Main-charactered'],
      ['Speedrunning', 'Speedran'], ['Lowkey thinking', 'Lowkey thought'], ['Highkey shipping', 'Highkey shipped'],
      ['Living rent-free', 'Lived rent-free'], ['Touching grass', 'Touched grass'], ['Sending it', 'Sent it'],
      ['Eating', 'Ate'], ['Serving', 'Served'], ["Making it bussin'", "Made it bussin'"], ['Entering my era', 'Entered my era'],
      ['Staying delulu', 'Stayed delulu'], ['Being so real', 'Was so real'], ['Giving', 'Gave'], ['Mogging bugs', 'Mogged bugs'],
      ['Hard-launching', 'Hard-launched'], ['Soft-launching', 'Soft-launched'], ['Doomscrolling', 'Doomscrolled'], ['Yapping', 'Yapped'],
    ],
  },
  {
    id: 'zen',
    emoji: '🍃',
    title: 'Zen',
    words: [
      ['Breathing', 'Breathed'], ['Centering', 'Centered'], ['Raking the gravel', 'Raked the gravel'], ['Sipping tea', 'Sipped tea'],
      ['Watching clouds', 'Watched clouds'], ['Letting go', 'Let go'], ['Being present', 'Was present'], ['Sitting with it', 'Sat with it'],
      ['Balancing stones', 'Balanced stones'], ['Listening to rain', 'Listened to rain'], ['Folding paper cranes', 'Folded paper cranes'],
      ['Pruning the bonsai', 'Pruned the bonsai'], ['Ringing the bell', 'Rang the bell'], ['Walking slowly', 'Walked slowly'],
      ['Noticing', 'Noticed'], ['Emptying the cup', 'Emptied the cup'], ['Following the breath', 'Followed the breath'],
      ['Settling', 'Settled'], ['Unfolding', 'Unfolded'], ['Meditating', 'Meditated'], ['Drifting', 'Drifted'], ['Grounding', 'Grounded'],
      ['Returning to stillness', 'Returned to stillness'], ['Watering the garden', 'Watered the garden'], ['Lighting incense', 'Lit incense'],
      ['Flowing', 'Flowed'], ['Sweeping the path', 'Swept the path'],
    ],
  },
  {
    id: 'retro',
    emoji: '💾',
    title: 'Retro',
    words: [
      ['Dialing up', 'Dialed up'], ['Defragmenting', 'Defragmented'], ['Rewinding the tape', 'Rewound the tape'],
      ['Blowing on the cartridge', 'Blew on the cartridge'], ['Hacking the mainframe', 'Hacked the mainframe'], ['Compiling', 'Compiled'],
      ['Buffering', 'Buffered'], ['Loading from cassette', 'Loaded from cassette'], ['Burning a CD', 'Burned a CD'],
      ['Formatting the floppy', 'Formatted the floppy'], ['Reticulating splines', 'Reticulated splines'], ['Booting', 'Booted'],
      ['Telnetting', 'Telnetted'], ['Pinging', 'Pinged'], ['Downloading more RAM', 'Downloaded more RAM'],
      ['Adjusting the antenna', 'Adjusted the antenna'], ['Overclocking', 'Overclocked'], ['Saving to disk', 'Saved to disk'],
      ['Entering cheat codes', 'Entered cheat codes'], ['Typing in BASIC', 'Typed in BASIC'], ['Waiting for the modem', 'Waited for the modem'],
      ['Sorting the mixtape', 'Sorted the mixtape'], ['Clearing the cache', 'Cleared the cache'], ['Untangling the cables', 'Untangled the cables'],
      ['Scanning for viruses', 'Scanned for viruses'], ['Writing to ROM', 'Wrote to ROM'], ['Inserting disk 2', 'Inserted disk 2'],
    ],
  },
]

export const PACK_IDS: readonly string[] = PACKS.map(p => p.id)

export function packById(id: string): Pack | undefined {
  return PACKS.find(p => p.id === id)
}

/**
 * Parses the `custom` option: comma-separated words, each optionally
 * `Present|Past` (`Frobbing|Frobbed`) to theme the closing line too.
 */
export function parseCustom(text: string): Pack | undefined {
  const words: Pair[] = text
    .split(',')
    .map(w => w.trim())
    .filter(w => w !== '')
    .map(w => {
      const [present, past] = w.split('|').map(s => s.trim())
      return [present ?? w, past !== undefined && past !== '' ? past : null] as const
    })
    .filter(([present]) => present !== '')
  if (words.length === 0) return undefined
  return { id: 'custom', emoji: '🎨', title: 'Custom', words }
}

/** A small, stable string hash (FNV-1a), so a seed always picks the same word. */
export function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Which pair a seed picks (one per turn and spinner). */
export function indexFor(pack: Pack, seed: string): number {
  return hash(seed) % pack.words.length
}

/** The word the spinner shows for this seed. */
export function presentFor(pack: Pack, seed: string): string {
  return pack.words[indexFor(pack, seed)]![0]
}

/** The past form of the pair at `index`, so the closing line echoes the spinner. */
export function pastAt(pack: Pack, index: number): string | undefined {
  return pack.words[index % pack.words.length]?.[1] ?? undefined
}

/** The past form for the closing line, or undefined when the pack has none for it. */
export function pastFor(pack: Pack, seed: string): string | undefined {
  const withPast = pack.words.filter(([, past]) => past !== null)
  if (withPast.length === 0) return undefined
  return withPast[hash(seed) % withPast.length]![1] ?? undefined
}

/** Three sample words for the /spinner listing. */
export function samples(pack: Pack, count = 3): string[] {
  const step = Math.max(1, Math.floor(pack.words.length / count))
  return Array.from({ length: Math.min(count, pack.words.length) }, (_, i) => pack.words[i * step]![0])
}
