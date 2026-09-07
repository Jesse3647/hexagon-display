/**
 * Accepts only the newest requested generation, including while an edit is debounced.
 * @param id Revision attached to the worker reply.
 * @param current Most recently issued editor revision, not the last successful one.
 */
export const isCurrentResult = (id: number, current: number) => id === current;
