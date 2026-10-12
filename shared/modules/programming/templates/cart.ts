import type { TemplateSpec } from '../types.ts';

const SMALL = "[{ name: 'Pen', price: '1.50', qty: '2' }, { name: 'Notebook', price: '4.25', qty: '1' }]";
const BIG = "[{ name: 'Backpack', price: '45.00', qty: '1' }, { name: 'Pen', price: '1.50', qty: '4' }]";

export const cart: TemplateSpec = {
  id: 'prog.cart',
  title: 'Shopping Cart Total',
  summary: 'Checkout totals are wrong for some orders. Form data arrives as strings, so watch your types.',
  difficultyRange: [2, 4],
  processWeights: { 'prog.reproduce': 0.5, 'prog.trace': 0.7, 'prog.localize': 0.7, 'prog.verify': 0.6 },
  prerequisites: ['prog.reproduce', 'prog.trace'],
  estimatedMinutes: 10,
  tags: ['javascript', 'type coercion', 'accumulators', 'money'],
  fileName: 'checkout.js',
  context: 'The online school store uses this code to total each order at checkout.',
  reporters: ['Store manager Mr. Chen', 'Customer email from a parent', 'Accounting (Mrs. Patel)'],
  pairs: [
    'count-concat+qty-length',
    'count-concat+total-assign',
    'count-concat+coupon-threshold',
    'count-concat+coupon-or',
    'count-concat+discount-subtract',
    'total-assign+coupon-threshold',
    'coupon-threshold+discount-subtract',
  ],
  code: `// Checkout totals. Cart items come straight from the order form, so every field
// is a string: { name: 'Pen', price: '1.50', qty: '2' }. Coupon SAVE10 takes 10%
// off orders of $50 or more (before tax). Sales tax is 8%. Round to cents.
const TAX_RATE = 0.08;

function itemCount(items) {
  let count = 0;
  for (const item of items) {
    count += Number(item.qty);
  }
  return count;
}

function subtotal(items) {
  let total = 0;
  for (const item of items) {
    total += Number(item.price) * Number(item.qty);
  }
  return total;
}

function cartTotal(items, coupon) {
  let amount = subtotal(items);
  if (coupon === 'SAVE10' && amount >= 50) {
    amount = amount * 0.9;
  }
  amount = amount * (1 + TAX_RATE);
  return Math.round(amount * 100) / 100;
}`,
  tests: [
    { id: 'count', name: 'item count adds the quantities', call: `itemCount(${SMALL})`, expected: 3, visible: true },
    { id: 'subtotal', name: 'subtotal multiplies price by quantity', call: `subtotal(${SMALL})`, expected: 7.25, visible: true },
    { id: 'total-no-coupon', name: 'small order with tax', call: `cartTotal(${SMALL}, '')`, expected: 7.83, visible: true },
    { id: 'total-coupon', name: 'SAVE10 on a $51 order', call: `cartTotal(${BIG}, 'SAVE10')`, expected: 49.57, visible: true },
    { id: 'total-big-no-coupon', name: '$51 order without a coupon', call: `cartTotal(${BIG}, '')`, expected: 55.08, visible: true },
    {
      id: 'coupon-threshold',
      name: 'SAVE10 on exactly $50',
      call: "cartTotal([{ name: 'Desk lamp', price: '25.00', qty: '2' }], 'SAVE10')",
      expected: 48.6,
      visible: true,
    },
    { id: 'count-empty', name: 'empty cart has 0 items', call: 'itemCount([])', expected: 0, visible: false },
    {
      id: 'total-mixed',
      name: 'SAVE10 with several items',
      call: "cartTotal([{ name: 'Mug', price: '12.99', qty: '3' }, { name: 'Tea', price: '6.50', qty: '2' }], 'SAVE10')",
      expected: 50.51,
      visible: false,
    },
    {
      id: 'subtotal-many',
      name: 'ten stickers',
      call: "subtotal([{ name: 'Sticker', price: '0.99', qty: '10' }])",
      expected: 9.9,
      visible: false,
    },
  ],
  bugs: [
    {
      id: 'count-concat',
      line: 9,
      find: 'Number(item.qty)',
      replace: 'item.qty',
      category: 'type_coercion',
      conceptSkill: 'prog.state',
      title: 'Quantities are concatenated as strings',
      explanation:
        "`item.qty` is a string from the form, and `0 + '2'` is the string '02', not 2: `+` concatenates when either side is a string. Convert first: `count += Number(item.qty)`.",
      symptom: "The cart badge shows '021' items instead of 3",
      repro: 'count',
      actual: "'021'",
      subtlety: 2,
      probe: 'Log `count` and `typeof count` after each loop iteration in `itemCount()`.',
      examine: 'What type is `item.qty`, and what does `+=` do when one side is a string?',
    },
    {
      id: 'qty-length',
      line: 17,
      find: 'Number(item.qty)',
      replace: 'items.length',
      category: 'wrong_variable',
      conceptSkill: 'prog.state',
      title: "Multiplies by the number of products instead of the item's quantity",
      explanation:
        '`items.length` is how many different products are in the cart, not how many of THIS item were ordered. Each line total must be price times that item\'s own quantity.',
      symptom: 'Subtotals are wrong for multi-product carts: 2 pens + 1 notebook shows $11.50 instead of $7.25',
      repro: 'subtotal',
      actual: '11.5',
      subtlety: 3,
      probe: 'Log `item.name`, `item.qty` and the amount added in each iteration of `subtotal()`.',
      examine: 'Which value should each price be multiplied by: something about the whole cart, or about this item?',
    },
    {
      id: 'total-assign',
      line: 17,
      find: 'total +=',
      replace: 'total =',
      category: 'wrong_operator',
      accept: ['wrong_initial_value'],
      conceptSkill: 'prog.state',
      title: 'Assignment overwrites the running total',
      explanation:
        '`total = ...` replaces the running total on every iteration, so only the last item counts. An accumulator must add to itself: `total += ...`.',
      symptom: 'Only the last product in the cart is charged',
      repro: 'subtotal',
      actual: '4.25',
      subtlety: 2,
      probe: 'Log `total` after each iteration of the loop in `subtotal()`.',
      examine: 'Does this line add to `total` or replace it?',
    },
    {
      id: 'coupon-threshold',
      line: 24,
      find: 'amount >= 50',
      replace: 'amount > 50',
      category: 'off_by_one',
      accept: ['wrong_operator'],
      conceptSkill: 'prog.boundaries',
      title: 'Coupon threshold excludes exactly $50',
      explanation:
        'The promotion applies to orders of $50 or more, so the check must be `amount >= 50`. With `>`, an order of exactly $50.00 is charged full price.',
      symptom: 'A $50.00 order with SAVE10 was charged full price',
      repro: 'coupon-threshold',
      actual: '54',
      subtlety: 3,
      probe: "Call `cartTotal([{ name: 'Desk lamp', price: '25.00', qty: '2' }], 'SAVE10')` and log `amount` before the coupon check.",
      examine: 'Does this condition accept an order of exactly 50?',
    },
    {
      id: 'coupon-or',
      line: 24,
      find: "coupon === 'SAVE10' && amount >= 50",
      replace: "coupon === 'SAVE10' || amount >= 50",
      category: 'wrong_operator',
      conceptSkill: 'prog.logic',
      title: '`||` gives the discount without a coupon',
      explanation:
        'The discount needs BOTH the SAVE10 coupon AND an order of at least $50. With `||` either one alone is enough, so every large order is discounted even without the coupon.',
      symptom: 'Large orders get 10% off even when no coupon is entered',
      repro: 'total-big-no-coupon',
      actual: '49.57',
      subtlety: 2,
      probe: 'Log `coupon`, `amount` and whether the `if` body runs for a $51 order with no coupon.',
      examine: 'Should the discount require both conditions, or is either one enough?',
    },
    {
      id: 'discount-subtract',
      line: 25,
      find: 'amount * 0.9',
      replace: 'amount - 0.1',
      category: 'wrong_operator',
      conceptSkill: 'prog.logic',
      title: 'Discount subtracts 10 cents instead of taking 10% off',
      explanation: '10% off means paying 90% of the amount: `amount * 0.9`. `amount - 0.1` only removes ten cents.',
      symptom: 'The SAVE10 coupon only takes about 10 cents off',
      repro: 'total-coupon',
      actual: '54.97',
      subtlety: 2,
      probe: 'Log `amount` before and after the discount line for a $51 order with SAVE10.',
      examine: "What arithmetic turns 'take 10% off' into code?",
    },
  ],
};
