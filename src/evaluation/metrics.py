"""
Evaluation metrics for the recommendation system.

Precision@K  — of the top K recommendations, what fraction are relevant?
Recall@K     — of all relevant items, what fraction did we retrieve in top K?
NDCG@K       — are the relevant items ranked near the top? (position-aware)
Coverage     — what % of the total catalogue ever gets recommended?
Diversity    — how different are the items within a single recommendation list?
"""

import numpy as np
import pandas as pd
from src.config import TEST_SPLIT_PATH, DEFAULT_TOP_K
from src.models.hybrid_model import HybridModel
from src.models.content_model import ContentModel
from src.models.collab_model import CollabModel


def precision_at_k(recommended: list[str], relevant: set[str], k: int) -> float:
    """What fraction of the top-K recommendations are relevant."""
    top_k = recommended[:k]
    hits = sum(1 for tid in top_k if tid in relevant)
    return hits / k if k > 0 else 0.0


def recall_at_k(recommended: list[str], relevant: set[str], k: int) -> float:
    """What fraction of all relevant items appear in the top-K."""
    top_k = recommended[:k]
    hits = sum(1 for tid in top_k if tid in relevant)
    return hits / len(relevant) if relevant else 0.0


def ndcg_at_k(recommended: list[str], relevant: set[str], k: int) -> float:
    """
    Normalised Discounted Cumulative Gain.
    Rewards finding relevant items AND finding them earlier in the list.
    Score of 1.0 means all relevant items are at the top, in order.
    """
    top_k = recommended[:k]
    dcg = sum(
        1.0 / np.log2(rank + 2)
        for rank, tid in enumerate(top_k)
        if tid in relevant
    )
    ideal_hits = min(len(relevant), k)
    idcg = sum(1.0 / np.log2(rank + 2) for rank in range(ideal_hits))
    return dcg / idcg if idcg > 0 else 0.0


def coverage(all_recommendations: list[list[str]], catalogue_size: int) -> float:
    """What % of the catalogue ever appears in any recommendation list."""
    recommended_set = set(tid for recs in all_recommendations for tid in recs)
    return len(recommended_set) / catalogue_size if catalogue_size > 0 else 0.0


def intra_list_diversity(recommended: list[str], combined_matrix: np.ndarray,
                          track_id_to_idx: dict[str, int]) -> float:
    """
    Average pairwise cosine DISTANCE between items in a recommendation list.
    Higher = more diverse recommendations (the model isn't just recommending
    the same song over and over in slightly different forms).
    """
    indices = [track_id_to_idx[tid] for tid in recommended if tid in track_id_to_idx]
    if len(indices) < 2:
        return 0.0

    vecs = combined_matrix[indices]
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    norms[norms == 0] = 1e-10
    normed = vecs / norms

    sim_matrix = normed @ normed.T
    np.fill_diagonal(sim_matrix, 0)

    n = len(indices)
    avg_sim = sim_matrix.sum() / (n * (n - 1)) if n > 1 else 0
    return round(1 - float(avg_sim), 4)  # distance = 1 - similarity


def build_relevance_set(df: pd.DataFrame, track_id: str,
                         by: str = "genre", top_n: int = 50) -> set[str]:
    """
    Define what counts as 'relevant' for evaluation.
    Two songs are relevant if they share the same genre AND theme pool.
    This is a proxy for ground-truth relevance since we have no real user ratings.
    """
    row = df[df["track_id"] == track_id]
    if row.empty:
        return set()

    genre = row.iloc[0]["genre"]
    theme = row.iloc[0]["primary_theme_pool"]

    relevant = df[
        (df["genre"] == genre) |
        (df["primary_theme_pool"] == theme)
    ]["track_id"].tolist()

    relevant = [tid for tid in relevant if tid != track_id]
    return set(relevant[:top_n])


def evaluate(k: int = DEFAULT_TOP_K, sample_size: int = 200) -> dict:
    """
    Run full evaluation on a sample from the test split.
    Returns a dict of all metric scores.
    """
    test_df = pd.read_csv(TEST_SPLIT_PATH)
    full_df = pd.read_csv("data/processed/tracks_clean.csv")

    content_model = ContentModel.load()
    collab_model = CollabModel.load()
    hybrid = HybridModel(content_model, collab_model)

    sample = test_df.sample(n=min(sample_size, len(test_df)), random_state=42)

    precisions, recalls, ndcgs, all_recs = [], [], [], []

    for _, row in sample.iterrows():
        track_id = row["track_id"]
        try:
            recs = hybrid.recommend(track_id, k=k)
        except Exception:
            continue

        rec_ids = [r["track_id"] for r in recs]
        relevant = build_relevance_set(full_df, track_id)

        precisions.append(precision_at_k(rec_ids, relevant, k))
        recalls.append(recall_at_k(rec_ids, relevant, k))
        ndcgs.append(ndcg_at_k(rec_ids, relevant, k))
        all_recs.append(rec_ids)

    import numpy as np
    cov = coverage(all_recs, len(full_df))

    diversity_scores = [
        intra_list_diversity(
            recs, content_model.combined_matrix, content_model.track_id_to_idx
        )
        for recs in all_recs
    ]

    results = {
        f"precision@{k}": round(float(np.mean(precisions)), 4),
        f"recall@{k}": round(float(np.mean(recalls)), 4),
        f"ndcg@{k}": round(float(np.mean(ndcgs)), 4),
        "coverage": round(cov, 4),
        "avg_intra_list_diversity": round(float(np.mean(diversity_scores)), 4),
        "n_evaluated": len(precisions),
    }

    print(f"\nEvaluation Results (K={k}, n={len(precisions)} tracks):")
    print("-" * 40)
    for metric, score in results.items():
        print(f"  {metric:<30} {score}")

    return results


if __name__ == "__main__":
    evaluate(k=DEFAULT_TOP_K, sample_size=200)