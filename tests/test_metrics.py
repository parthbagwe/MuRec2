import numpy as np

from src.evaluation.metrics import coverage, intra_list_diversity, ndcg_at_k, precision_at_k, recall_at_k
from src.subgenres import infer_subgenre, subgenre_similarity
from src.acoustic_index import AcousticIndex, _genre_similarity, _recording_identity


def test_ranking_metrics():
    recommended = ["a", "b", "c", "d"]
    relevant = {"a", "c", "z"}
    assert precision_at_k(recommended, relevant, 4) == 0.5
    assert recall_at_k(recommended, relevant, 4) == 2 / 3
    assert 0 < ndcg_at_k(recommended, relevant, 4) < 1


def test_coverage_and_diversity():
    assert coverage([["a", "b"], ["b", "c"]], 4) == 0.75
    vectors = np.array([[1.0, 0.0], [0.0, 1.0]])
    assert intra_list_diversity(["a", "b"], vectors, {"a": 0, "b": 1}) == 1.0


def test_microgenre_guardrail_distinguishes_broad_neighbors():
    exact = subgenre_similarity("nu metal", "nu metal")
    adjacent = subgenre_similarity("nu metal", "industrial metal")
    same_family = subgenre_similarity("nu metal", "thrash metal")
    broad_neighbor = subgenre_similarity("nu metal", "alternative rock")
    assert exact > adjacent > same_family > broad_neighbor


def test_artist_taxonomy_does_not_match_a_name_fragment():
    assert infer_subgenre("Marc Korn", "Dance", "electronic", "Example") != "nu metal"


def test_soundtrack_label_does_not_create_a_second_recording_identity():
    assert _recording_identity("Aaruyire", "A.R. Rahman") == _recording_identity(
        'Aaruyire (From "Guru")', "A.R. Rahman"
    )


def _fingerprint(bpm, key, mode="major", energy=55):
    key_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    vector = np.zeros(35)
    vector[2] = energy / 100
    vector[10:23] = np.linspace(-20, 20, 13)
    vector[23 + key_names.index(key)] = 1
    profile = {
        "bpm": bpm, "tempo_confidence": .9, "onset_density": 2.5, "beat_regularity": .85,
        "percussive_ratio": .52, "danceability": .8, "brightness": .45,
        "spectral_flatness": .08, "spectral_contrast": 22, "zero_crossing_rate": .08,
        "harmonic_ratio": .6, "aggression": .48, "dynamic_range": .45,
        "tonal_strength": .8, "energy": energy, "key": key, "mode": mode,
    }
    return {"vector": vector, "profile": profile, "acoustic_signature": "driving · dense-balanced"}


def test_transition_scoring_rewards_mixable_tempo_and_key():
    anchor = _fingerprint(120, "C", "major")
    compatible = _fingerprint(123, "G", "major", 58)
    incompatible = _fingerprint(164, "F#", "minor", 82)
    row = {"title": "Song", "artist": "Artist", "subgenre": "dance pop"}
    compatible_metrics = AcousticIndex.transition_metrics(anchor, compatible, anchor, row, row, row)
    incompatible_metrics = AcousticIndex.transition_metrics(anchor, incompatible, anchor, row, row, row)
    assert AcousticIndex.key_compatibility(anchor, compatible) > AcousticIndex.key_compatibility(anchor, incompatible)
    assert compatible_metrics["score"] > incompatible_metrics["score"]
    assert "BPM" in compatible_metrics["note"]


def test_vibe_lock_detects_opposed_title_mood_even_when_audio_matches():
    fingerprint = _fingerprint(144, "B", "minor", 40)
    anchor = {"title": "One Love", "album": "One Love"}
    cheerful = {"title": "Love Me", "album": "Good Time"}
    heartbreak = {"title": "When I Was Your Man", "album": "Unorthodox Jukebox"}
    cheerful_vibe = AcousticIndex.vibe_similarity(fingerprint, fingerprint, anchor, cheerful)
    heartbreak_vibe = AcousticIndex.vibe_similarity(fingerprint, fingerprint, anchor, heartbreak)
    assert cheerful_vibe["title"] == 1
    assert heartbreak_vibe["title"] == 0
    assert cheerful_vibe["value"] > heartbreak_vibe["value"]


def test_primary_genre_distinguishes_pop_from_bollywood_even_with_pop_subgenre():
    pop = {"provider_genre": "Pop", "provider_subgenre": "pop"}
    bollywood = {"provider_genre": "Bollywood", "provider_subgenre": "pop"}
    assert _genre_similarity(pop, pop) == 1
    assert _genre_similarity(pop, bollywood) < 1
