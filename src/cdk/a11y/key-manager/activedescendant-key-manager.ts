/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import { ListKeyManager, IListKeyManagerOption } from './list-key-manager';


/**
 * This is the interface for highlightable items (used by the ActiveDescendantKeyManager).
 * Each item must know how to style itself as active or inactive and whether or not it is
 * currently disabled.
 */
export interface IHighlightable extends IListKeyManagerOption {
    // Applies the styles for an active item to this item.
    setActiveStyles(): void;

    // Applies the styles for an inactive item to this item.
    setInactiveStyles(): void;
}

export class ActiveDescendantKeyManager<T> extends ListKeyManager<IHighlightable & T> {

    /**
     * This method sets the active item to the item at the specified index.
     * It also adds active styles to the newly active item and removes active
     * styles from the previously active item.
     */
    setActiveItem(index: number): void {
        if (this.activeItem) {
            this.activeItem.setInactiveStyles();
        }
        super.setActiveItem(index);
        if (this.activeItem) {
            this.activeItem.setActiveStyles();
        }
    }

}
