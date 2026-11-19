// Seven semantic inputs, one deterministic total. Missing scores stay missing.
export function validateOptionalScore(score) {
  if (score === undefined) return
  const dimensions = ['auth', 'comp', 'rel', 'fresh', 'struct', 'reuse', 'risk']
  if (!score || dimensions.some(key => !Number.isFinite(score[key]) || score[key] < 0 || score[key] > 1))
    throw new Error('A provided qscore requires seven finite dimensions in [0,1]')
  const total = Number((score.auth * .2 + score.comp * .2 + score.rel * .15 + score.fresh * .15 + score.struct * .1 + score.reuse * .1 + (1 - score.risk) * .1).toFixed(4))
  if (score.total !== total) throw new Error('Score total does not match the seven dimensions')
}
