"""Fine-grained genre taxonomy for recommendation scoring.

Apple exposes useful but broad primary genres. This layer combines those labels
with a curated artist taxonomy so, for example, nu metal is not treated as an
exact match for progressive or indie rock.
"""

from __future__ import annotations

import re


ARTISTS_BY_SUBGENRE = {
    "nu metal": {
        "slipknot", "korn", "linkin park", "limp bizkit", "papa roach",
        "system of a down", "disturbed", "mudvayne", "static x", "p o d",
        "drowning pool", "coal chamber", "mushroomhead", "sevendust", "kittie",
    },
    "alternative metal": {
        "deftones", "tool", "a perfect circle", "faith no more", "chevelle",
        "breaking benjamin", "evanescence", "audioslave", "three days grace",
        "alice in chains", "helmet", "primus",
    },
    "metalcore": {
        "bring me the horizon", "killswitch engage", "bullet for my valentine",
        "architects", "parkway drive", "bad omens", "spiritbox", "trivium",
        "asking alexandria", "avenged sevenfold", "motionless in white",
    },
    "thrash metal": {
        "metallica", "megadeth", "slayer", "anthrax", "testament", "exodus",
        "sepultura", "kreator", "overkill",
    },
    "death metal": {
        "death", "cannibal corpse", "morbid angel", "obituary", "carcass",
        "deicide", "possessed", "amon amarth",
    },
    "black metal": {
        "mayhem", "darkthrone", "emperor", "immortal", "burzum", "bathory",
        "satyricon", "gorgoroth",
    },
    "doom metal": {
        "candlemass", "electric wizard", "sleep", "saint vitus", "pentagram",
        "type o negative", "my dying bride",
    },
    "progressive metal": {
        "dream theater", "opeth", "gojira", "mastodon", "meshuggah", "periphery",
        "queensryche", "between the buried and me", "haken",
    },
    "industrial metal": {
        "rammstein", "ministry", "fear factory", "marilyn manson", "rob zombie",
        "white zombie", "nine inch nails",
    },
    "power metal": {
        "dragonforce", "helloween", "blind guardian", "sabaton", "powerwolf",
        "hammerfall", "stratovarius",
    },
    "symphonic metal": {
        "nightwish", "within temptation", "epica", "lacuna coil", "delain",
    },
    "glam metal": {
        "motley crue", "poison", "def leppard", "bon jovi", "ratt", "warrant",
        "twisted sister", "skid row",
    },
    "heavy metal": {
        "iron maiden", "judas priest", "ozzy osbourne", "dio", "black sabbath",
        "motorhead", "pantera", "accept", "manowar",
    },
    "progressive rock": {
        "porcupine tree", "pink floyd", "yes", "king crimson", "genesis", "rush",
        "jethro tull", "the mars volta", "steven wilson",
    },
    "grunge": {
        "nirvana", "pearl jam", "soundgarden", "stone temple pilots", "mudhoney",
        "temple of the dog",
    },
    "alternative rock": {
        "radiohead", "muse", "foo fighters", "coldplay", "placebo",
        "the smashing pumpkins", "queens of the stone age", "incubus",
        "red hot chili peppers", "the cranberries", "weezer",
    },
    "indie rock": {
        "arctic monkeys", "the strokes", "the killers", "vampire weekend",
        "franz ferdinand", "the national", "interpol", "bloc party", "the kooks",
        "cage the elephant", "the local train", "lord huron",
    },
    "shoegaze": {"my bloody valentine", "slowdive", "ride", "lush", "diiv"},
    "post punk": {
        "joy division", "the cure", "siouxsie and the banshees", "bauhaus",
        "fontaines d c", "idles", "talking heads",
    },
    "pop punk": {
        "green day", "blink 182", "sum 41", "paramore", "fall out boy",
        "the offspring", "new found glory", "simple plan", "good charlotte",
    },
    "emo": {
        "my chemical romance", "taking back sunday", "dashboard confessional",
        "jimmy eat world", "the used", "pierce the veil",
    },
    "hard rock": {
        "ac dc", "guns n roses", "led zeppelin", "aerosmith", "deep purple",
        "van halen", "scorpions", "whitesnake", "audioslave",
    },
    "psychedelic rock": {
        "tame impala", "the doors", "cream", "jefferson airplane", "mgmt",
        "king gizzard and the lizard wizard",
    },
    "punk rock": {
        "ramones", "the clash", "sex pistols", "bad religion", "dead kennedys",
        "rancid", "black flag",
    },
    "synthpop": {
        "depeche mode", "pet shop boys", "new order", "a ha", "chvrches",
        "the human league", "erasure",
    },
    "dream pop": {"beach house", "cocteau twins", "cigarettes after sex", "mazzy star"},
    "house": {"daft punk", "disclosure", "deadmau5", "fred again", "calvin harris"},
    "techno": {"charlotte de witte", "amelie lens", "carl cox", "jeff mills"},
    "drum and bass": {"pendulum", "sub focus", "chase and status", "netsky"},
    "dubstep": {"skrillex", "excision", "zeds dead", "virtual riot"},
    "trap": {"future", "travis scott", "21 savage", "metro boomin", "lil baby"},
    "boom bap": {"nas", "wu tang clan", "a tribe called quest", "gang starr"},
    "neo soul": {"erykah badu", "d angelo", "jill scott", "maxwell"},
}

TRACK_OVERRIDES = {
    ("slipknot", "duality"): "nu metal",
    ("slipknot", "snuff"): "alternative metal",
    ("porcupine tree", "lazarus"): "alternative rock",
}

GENRE_ALIASES = {
    "prog rock art rock": "progressive rock",
    "indie rock": "indie rock",
    "alternative": "alternative rock",
    "hard rock": "hard rock",
    "metal": "heavy metal",
    "rock": "rock",
    "punk": "punk rock",
    "electronic": "electronic",
    "dance": "dance pop",
    "hip hop rap": "hip-hop",
    "r b soul": "r&b",
    "singer songwriter": "singer-songwriter",
    "new age": "ambient",
}

SEED_ALIASES = {
    "metal": "heavy metal", "indie": "indie rock", "rock": "rock",
    "hip-hop": "hip-hop", "r&b": "r&b", "electronic": "electronic",
    "ambient": "ambient", "folk": "folk", "soul": "soul", "pop": "pop",
}

FAMILIES = {
    "metal": {
        "nu metal", "alternative metal", "metalcore", "thrash metal", "death metal",
        "black metal", "doom metal", "progressive metal", "industrial metal",
        "power metal", "symphonic metal", "glam metal", "heavy metal",
    },
    "rock": {
        "progressive rock", "grunge", "alternative rock", "indie rock", "shoegaze",
        "post punk", "pop punk", "emo", "hard rock", "psychedelic rock",
        "punk rock", "rock",
    },
    "electronic": {"electronic", "house", "techno", "drum and bass", "dubstep", "ambient", "synthpop"},
    "pop": {"pop", "dance pop", "dream pop", "synthpop", "indie pop", "k-pop"},
    "hip-hop": {"hip-hop", "trap", "boom bap", "drill"},
    "r&b": {"r&b", "neo soul", "soul", "funk"},
}

ADJACENT = {
    "nu metal": {"alternative metal": .78, "industrial metal": .62, "metalcore": .58, "hard rock": .42},
    "alternative metal": {"progressive metal": .62, "metalcore": .60, "hard rock": .55},
    "progressive metal": {"progressive rock": .72, "alternative metal": .62, "heavy metal": .48},
    "heavy metal": {"thrash metal": .65, "power metal": .58, "glam metal": .52, "hard rock": .46},
    "indie rock": {"alternative rock": .75, "post punk": .58, "dream pop": .52},
    "alternative rock": {"grunge": .66, "indie rock": .75, "hard rock": .52, "progressive rock": .42},
    "progressive rock": {"psychedelic rock": .62, "alternative rock": .42, "progressive metal": .72},
    "pop punk": {"emo": .74, "punk rock": .66, "alternative rock": .48},
    "shoegaze": {"dream pop": .74, "indie rock": .58, "alternative rock": .52},
}


def _normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value).lower()).strip()


ARTIST_INDEX = sorted(
    ((_normalize(artist), subgenre) for subgenre, artists in ARTISTS_BY_SUBGENRE.items() for artist in artists),
    key=lambda item: len(item[0]),
    reverse=True,
)


def infer_subgenre(artist: str, genre: str, seed_genre: str = "", title: str = "") -> str:
    artist_key = _normalize(artist)
    title_key = _normalize(title)
    for (override_artist, override_title), subgenre in TRACK_OVERRIDES.items():
        if _normalize(override_artist) in artist_key and title_key.startswith(_normalize(override_title)):
            return subgenre

    padded_artist = f" {artist_key} "
    for known_artist, subgenre in ARTIST_INDEX:
        if f" {known_artist} " in padded_artist:
            return subgenre

    normalized_genre = _normalize(genre)
    if normalized_genre in GENRE_ALIASES:
        return GENRE_ALIASES[normalized_genre]
    normalized_seed = str(seed_genre).lower().strip()
    if normalized_seed in SEED_ALIASES:
        return SEED_ALIASES[normalized_seed]
    return str(genre or seed_genre or "Music").lower().strip()


def family_for(subgenre: str) -> str:
    value = str(subgenre).lower().strip()
    for family, members in FAMILIES.items():
        if value in members:
            return family
    return value


def subgenre_similarity(first: str, second: str) -> float:
    left = str(first).lower().strip()
    right = str(second).lower().strip()
    if not left or not right:
        return 0.05
    if left == right:
        return 1.0
    if right in ADJACENT.get(left, {}):
        return ADJACENT[left][right]
    if left in ADJACENT.get(right, {}):
        return ADJACENT[right][left]
    left_family = family_for(left)
    right_family = family_for(right)
    if left_family == right_family:
        return 0.34
    if {left_family, right_family} == {"metal", "rock"}:
        return 0.14
    if {left_family, right_family} in ({"pop", "rock"}, {"pop", "electronic"}, {"hip-hop", "r&b"}):
        return 0.12
    return 0.04
