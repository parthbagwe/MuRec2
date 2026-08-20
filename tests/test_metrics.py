import numpy as np

from src.evaluation.metrics import coverage, intra_list_diversity, ndcg_at_k, precision_at_k, recall_at_k
from src.subgenres import infer_subgenre, subgenre_similarity


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
