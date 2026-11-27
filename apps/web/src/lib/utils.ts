import { createCn } from 'cn/config';

/**
 * Joins class names and lets a later class win over an earlier one of the same kind.
 *
 * The type scale of src/styles/app.css adds sizes named `text-item`, `text-meta` and
 * so on. Left alone, the merger reads an unknown `text-<name>` as a text colour and
 * drops it when a colour follows. This tells it that they are sizes. Every component
 * imports `cn` from here, the generated ones in components/ui included.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'figure',
            'item',
            'title',
            'lead',
            'reading',
            'line',
            'body',
            'meta',
            'small',
            'micro',
          ],
        },
      ],
    },
  },
});
