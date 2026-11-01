/**
 * What the operator is told: the rules once, then a report each morning. Everything the
 * report says comes from the shop's books and the events since the last report, so the
 * same season always produces the same words, which replay relies on.
 */
import { productsOf } from '@terrarium/vending/Product'
import { type Books, unitsOf } from '@terrarium/vending/Shop/Books'

/** The operator's standing instructions. */
export const rules = (books: Books): string =>
  [
    `You run a small vending machine business for a ${books.lastDay}-day season.`,
    'You are scored on the cash you hold when the season ends.',
    '',
    'How the business works:',
    '- All money is in whole cents: 250 means $2.50.',
    '- Customers buy only from the machine. Stock you order is paid for at once and arrives in the storeroom',
    `  ${books.leadDays} day(s) later. Move it into the machine with StockMachine.`,
    '- Each product has a unit cost (what the supplier charges) and a price (what customers pay).',
    '  Fewer customers buy when your price is above the usual price, and more when it is below.',
    `- Each night a fee of ${books.dailyFee} is charged. If you can't pay it, the shop goes bankrupt`,
    '  and the season ends.',
    '',
    'Every morning you get a report. Use the tools to run the shop, then call WaitForNextDay to end',
    'the day. Time only moves when you call WaitForNextDay.',
  ].join('\n')

/** What happened overnight, as the report tells it. */
export interface Overnight {
  readonly sales: ReadonlyArray<{
    readonly product: string
    readonly price: number
    readonly wanted: number
    readonly sold: number
    readonly revenue: number
  }>
  readonly fee: number | undefined
  readonly deliveries: ReadonlyArray<{ readonly product: string; readonly quantity: number }>
}

export const quiet: Overnight = { sales: [], fee: undefined, deliveries: [] }

/** The morning report: yesterday's sales, today's deliveries, and where every product stands. */
export const morning = (books: Books, overnight: Overnight): string => {
  const lines = [`Day ${books.day} of ${books.lastDay}. Cash: ${books.cash}.`]
  if (overnight.sales.length > 0 || overnight.fee !== undefined) {
    lines.push('', `Yesterday (day ${books.day - 1}):`)
    for (const line of overnight.sales)
      lines.push(
        `- ${line.product}: sold ${line.sold} of ${line.wanted} wanted at ${line.price}, revenue ${line.revenue}` +
          (line.wanted > line.sold ? ' (the machine ran out)' : ''),
      )
    const revenue = overnight.sales.reduce((sum, line) => sum + line.revenue, 0)
    lines.push(`- total revenue ${revenue}, fee ${overnight.fee ?? 0}`)
  }
  if (overnight.deliveries.length > 0)
    lines.push(
      '',
      `Delivered to the storeroom this morning: ${overnight.deliveries
        .map(({ product, quantity }) => `${quantity} ${product}`)
        .join(', ')}.`,
    )
  lines.push('', 'Products:')
  for (const product of productsOf(books.catalog)) {
    const item = books.catalog[product]!
    const onOrder = books.orders.filter(order => order.product === product)
    lines.push(
      `- ${product}: unit cost ${item.unitCost}, price ${books.prices[product] ?? item.defaultPrice}` +
        ` (usual ${item.defaultPrice}), machine ${unitsOf(books.machine, product)},` +
        ` storeroom ${unitsOf(books.storage, product)}` +
        (onOrder.length === 0
          ? ''
          : `, on order ${onOrder
              .map(order => `${order.quantity} arriving day ${order.arrivesOn}`)
              .join(' and ')}`),
    )
  }
  return lines.join('\n')
}

/** Sent when the model answers without calling a tool, so the day can go on. */
export const nudge =
  'Use the tools to run the shop. When you are done for today, call WaitForNextDay.'
