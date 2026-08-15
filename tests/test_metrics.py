import numpy as np

from src.evaluation.metrics import coverage, intra_list_diversity, ndcg_at_k, precision_at_k, recall_at_k


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
