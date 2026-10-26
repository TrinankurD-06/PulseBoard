/**
 * Runs a paginated find and returns the API's list envelope:
 * { data: [...], pagination: { page, limit, total, totalPages } }.
 * `buildQuery` lets callers add sort/populate/select to the find query.
 */
export async function paginate(model, filter, { page, limit }, buildQuery = (query) => query) {
  const [items, total] = await Promise.all([
    buildQuery(
      model
        .find(filter)
        .skip((page - 1) * limit)
        .limit(limit),
    ),
    model.countDocuments(filter),
  ]);
  return {
    data: items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
