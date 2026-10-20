import { getDatabase } from '../utils/database'

export default defineEventHandler(async (event) => await getDatabase(event).prepare(`SELECT retrieved_at AS retrievedAt,
  repository_url AS repositoryUrl, source_url AS sourceUrl, item_count AS itemCount,
  recipe_count AS recipeCount, changelog_count AS changelogCount, dataset_sha256 AS sha256
  FROM source_imports ORDER BY id DESC LIMIT 1`).first() ?? null)
