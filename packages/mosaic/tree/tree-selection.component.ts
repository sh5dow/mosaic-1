/* tslint:disable:no-empty */
import { coerceBooleanProperty } from '@angular/cdk/coercion';
import { SelectionModel } from '@angular/cdk/collections';
import {
    AfterContentInit,
    Attribute,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    ContentChildren,
    ElementRef,
    EventEmitter,
    forwardRef,
    Input,
    IterableDiffer,
    IterableDiffers,
    Output,
    QueryList,
    ViewChild, ViewContainerRef,
    ViewEncapsulation
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { FocusKeyManager } from '@ptsecurity/cdk/a11y';
import {
    hasModifierKey,
    END,
    ENTER,
    HOME,
    LEFT_ARROW,
    PAGE_DOWN,
    PAGE_UP,
    RIGHT_ARROW,
    SPACE,
    DOWN_ARROW,
    UP_ARROW
} from '@ptsecurity/cdk/keycodes';
import { CdkTree, CdkTreeNodeOutlet, FlatTreeControl } from '@ptsecurity/cdk/tree';
import {
    CanDisable,
    getMcSelectNonArrayValueError,
    HasTabIndex,
    MultipleMode
} from '@ptsecurity/mosaic/core';
import { merge, Observable, Subject, Subscription } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { MC_TREE_OPTION_PARENT_COMPONENT, McTreeOption, McTreeOptionEvent } from './tree-option.component';


export const MC_SELECTION_TREE_VALUE_ACCESSOR: any = {
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => McTreeSelection),
    multi: true
};

export class McTreeNavigationChange<T> {
    constructor(public source: McTreeSelection<any>, public option: T) {}
}

export class McTreeSelectionChange<T> {
    constructor(public source: McTreeSelection<any>, public option: T) {}
}

// tslint:disable-next-line:naming-convention
interface SelectionModelOption {
    id: number | string;
    value: string;
}


@Component({
    selector: 'mc-tree-selection',
    exportAs: 'mcTreeSelection',
    template: '<ng-container cdkTreeNodeOutlet></ng-container>',
    styleUrls: ['./tree.scss'],
    host: {
        class: 'mc-tree-selection',

        '[attr.tabindex]': 'tabIndex',
        '[attr.disabled]': 'disabled || null',

        '(blur)': 'blur()',
        '(focus)': 'focus($event)',

        '(keydown)': 'onKeyDown($event)',
        '(window:resize)': 'updateScrollSize()'
    },
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [
        MC_SELECTION_TREE_VALUE_ACCESSOR,
        { provide: MC_TREE_OPTION_PARENT_COMPONENT, useExisting: McTreeSelection },
        { provide: CdkTree, useExisting: McTreeSelection }
    ]
})
export class McTreeSelection<T extends McTreeOption> extends CdkTree<T>
    implements ControlValueAccessor, AfterContentInit, CanDisable, HasTabIndex {

    @ViewChild(CdkTreeNodeOutlet, { static: true }) nodeOutlet: CdkTreeNodeOutlet;

    @ContentChildren(McTreeOption) unorderedOptions: QueryList<T>;

    renderedOptions = new QueryList<T>();

    keyManager: FocusKeyManager<T>;

    selectionModel: SelectionModel<SelectionModelOption>;

    resetFocusedItemOnBlur: boolean = true;

    @Input() treeControl: FlatTreeControl<T>;

    @Output() readonly navigationChange = new EventEmitter<McTreeNavigationChange<T>>();

    @Output() readonly selectionChange = new EventEmitter<McTreeSelectionChange<T>>();

    multipleMode: MultipleMode | null = null;

    userTabIndex: number | null = null;

    private sortedNodes: T[] = [];

    @Input()
    get autoSelect(): boolean {
        return this._autoSelect;
    }

    set autoSelect(value: boolean) {
        this._autoSelect = coerceBooleanProperty(value);
    }

    private _autoSelect: boolean = true;

    get optionFocusChanges(): Observable<McTreeOptionEvent> {
        return merge(...this.renderedOptions.map((option) => option.onFocus));
    }

    get optionBlurChanges(): Observable<McTreeOptionEvent> {
        return merge(...this.renderedOptions.map((option) => option.onBlur));
    }

    get multiple(): boolean {
        return !!this.multipleMode;
    }

    @Input()
    get noUnselectLast(): boolean {
        return this._noUnselectLast;
    }

    set noUnselectLast(value: boolean) {
        this._noUnselectLast = coerceBooleanProperty(value);
    }

    private _noUnselectLast: boolean = true;

    @Input()
    get disabled(): boolean {
        return this._disabled;
    }

    set disabled(rawValue: boolean) {
        const value = coerceBooleanProperty(rawValue);

        if (this._disabled !== value) {
            this._disabled = value;

            this.markOptionsForCheck();
        }
    }

    private _disabled: boolean = false;

    @Input()
    get tabIndex(): any {
        return this.disabled ? -1 : this._tabIndex;
    }

    set tabIndex(value: any) {
        this._tabIndex = value;
        this.userTabIndex = value;
    }

    private _tabIndex = 0;

    get showCheckbox(): boolean {
        return this.multipleMode === MultipleMode.CHECKBOX;
    }

    private readonly destroy = new Subject<void>();

    private optionFocusSubscription: Subscription | null;

    private optionBlurSubscription: Subscription | null;

    constructor(
        private elementRef: ElementRef,
        differs: IterableDiffers,
        changeDetectorRef: ChangeDetectorRef,
        @Attribute('multiple') multiple: MultipleMode
    ) {
        super(differs, changeDetectorRef);

        if (multiple === MultipleMode.CHECKBOX || multiple === MultipleMode.KEYBOARD) {
            this.multipleMode = multiple;
        } else if (multiple !== null) {
            this.multipleMode = MultipleMode.CHECKBOX;
        }

        if (this.multipleMode === MultipleMode.CHECKBOX) {
            this.autoSelect = false;
            this.noUnselectLast = false;
        }

        this.selectionModel = new SelectionModel<SelectionModelOption>(this.multiple);
    }

    ngAfterContentInit(): void {
        this.unorderedOptions.changes.subscribe(this.updateRenderedOptions);

        this.keyManager = new FocusKeyManager<T>(this.renderedOptions)
            .withVerticalOrientation(true)
            .withHorizontalOrientation(null);

        this.keyManager.change
            .pipe(takeUntil(this.destroy))
            .subscribe(() => {
                if (this.keyManager.activeItem) {
                    this.emitNavigationEvent(this.keyManager.activeItem);

                    // todo need check this logic
                    if (this.autoSelect && !this.keyManager.activeItem.disabled) {
                        this.updateOptionsFocus();
                    }
                }
            });

        this.keyManager.tabOut
            .pipe(takeUntil(this.destroy))
            .subscribe(() => this.allowFocusEscape());

        this.selectionModel.changed
            .pipe(takeUntil(this.destroy))
            .subscribe(() => {
                this.onChange(this.getSelectedValues());

                this.renderedOptions.notifyOnChanges();
            });

        this.renderedOptions.changes
            .pipe(takeUntil(this.destroy))
            .subscribe((options) => {
                this.resetOptions();

                // Check to see if we need to update our tab index
                this.updateTabIndex();

                // todo need to do optimisation
                options.forEach((option) => {
                    option.deselect();

                    this.getSelectedValues().forEach((selectedValue) => {
                        if (option.value === selectedValue) {
                            option.select();
                        }
                    });

                    option.changeDetectorRef.detectChanges();
                });
            });
    }

    ngOnDestroy(): void {
        this.destroy.next();
        this.destroy.complete();
    }

    focus($event): void {
        if (this.renderedOptions.length === 0 || this.isFocusReceivedFromNestedOption($event)) { return; }

        this.keyManager.setFirstItemActive();
    }

    blur() {
        if (!this.hasFocusedOption() && this.resetFocusedItemOnBlur) {
            this.keyManager.setActiveItem(-1);
        }

        this.onTouched();
        this.changeDetectorRef.markForCheck();
    }

    onKeyDown(event: KeyboardEvent): void {
        this.keyManager.setFocusOrigin('keyboard');
        // tslint:disable-next-line: deprecation
        const keyCode = event.keyCode;

        switch (keyCode) {
            case DOWN_ARROW:
                this.keyManager.setNextItemActive();

                break;
            case UP_ARROW:
                this.keyManager.setPreviousItemActive();

                break;
            case LEFT_ARROW:
                if (this.keyManager.activeItem) {
                    this.treeControl.collapse(this.keyManager.activeItem.data as T);
                }

                event.preventDefault();

                return;
            case RIGHT_ARROW:
                if (this.keyManager.activeItem) {
                    this.treeControl.expand(this.keyManager.activeItem.data as T);
                }

                event.preventDefault();

                return;
            case SPACE:
            case ENTER:
                this.toggleFocusedOption();
                event.preventDefault();

                break;
            case HOME:
                this.keyManager.setFirstItemActive();
                event.preventDefault();

                break;
            case END:
                this.keyManager.setLastItemActive();
                event.preventDefault();

                break;
            case PAGE_UP:
                this.keyManager.setPreviousPageItemActive();
                event.preventDefault();

                break;
            case PAGE_DOWN:
                this.keyManager.setNextPageItemActive();
                event.preventDefault();

                break;
            default:
                return;
        }

        if (this.keyManager.activeItem) {
            this.setSelectedOptionsByKey(
                this.keyManager.activeItem, hasModifierKey(event, 'shiftKey'), hasModifierKey(event, 'ctrlKey')
            );
        }
    }

    updateScrollSize(): void {
        if (!this.renderedOptions.first) { return; }

        this.keyManager.withScrollSize(Math.floor(this.getHeight() / this.renderedOptions.first.getHeight()));
    }

    setSelectedOptionsByKey(option: T, shiftKey: boolean, ctrlKey: boolean): void {
        if (shiftKey && this.multiple) {
            this.setSelectedOptions(option);
        } else if (ctrlKey) {
            if (!this.canDeselectLast(option)) { return; }
        } else if (this.autoSelect) {
            this.selectionModel.clear();
            this.selectionModel.toggle(option.data);
        }

        this.emitChangeEvent(option);
    }

    setSelectedOptionsByClick(option: T, shiftKey: boolean, ctrlKey: boolean): void {
        if (!shiftKey && !ctrlKey) {
            this.keyManager.setActiveItem(option);
        }

        if (shiftKey && this.multiple) {
            this.setSelectedOptions(option);
        } else if (ctrlKey) {
            if (!this.canDeselectLast(option)) { return; }

            this.selectionModel.toggle(option.data);
        } else if (this.autoSelect) {
            this.selectionModel.clear();
            this.selectionModel.toggle(option.data);
        } else {
            this.selectionModel.toggle(option.data);
        }

        this.emitChangeEvent(option);
    }

    setSelectedOptions(option: T): void {
        const selectedOptionState = option.selected;

        let fromIndex = this.keyManager.previousActiveItemIndex;
        let toIndex = this.keyManager.previousActiveItemIndex = this.keyManager.activeItemIndex;

        if (toIndex === fromIndex) { return; }

        if (fromIndex > toIndex) {
            [fromIndex, toIndex] = [toIndex, fromIndex];
        }

        this.renderedOptions
            .toArray()
            .slice(fromIndex, toIndex + 1)
            .filter((item) => !item.disabled)
            .forEach((renderedOption) => {
                const isLastRenderedOption = renderedOption === this.keyManager.activeItem;

                if (isLastRenderedOption && renderedOption.selected && this.noUnselectLast) { return; }

                renderedOption.setSelected(!selectedOptionState);
            });
    }

    setFocusedOption(option: T): void {
        this.keyManager.setActiveItem(option);
    }

    toggleFocusedOption(): void {
        const focusedOption = this.keyManager.activeItem;

        if (focusedOption && (!focusedOption.selected || this.canDeselectLast(focusedOption))) {
            focusedOption.toggle();
            this.emitChangeEvent(focusedOption);
        }
    }

    renderNodeChanges(
        data: T[],
        dataDiffer: IterableDiffer<T> = this.dataDiffer,
        viewContainer: ViewContainerRef = this.nodeOutlet.viewContainer,
        parentData?: T
    ): void {
        super.renderNodeChanges(data, dataDiffer, viewContainer, parentData);

        this.sortedNodes = this.getSortedNodes(viewContainer);

        this.updateScrollSize();

        this.nodeOutlet.changeDetectorRef.detectChanges();
    }

    getHeight(): number {
        const clientRects = this.elementRef.nativeElement.getClientRects();

        if (clientRects.length) {
            return clientRects[0].height;
        }

        return 0;
    }

    getItemHeight(): number {
        return this.renderedOptions.first ? this.renderedOptions.first.getHeight() : 0;
    }

    emitNavigationEvent(option: T): void {
        this.navigationChange.emit(new McTreeNavigationChange(this, option));
    }

    emitChangeEvent(option: T): void {
        this.selectionChange.emit(new McTreeNavigationChange(this, option));
    }

    writeValue(value: any): void {
        if (this.multiple && value && !Array.isArray(value)) {
            throw getMcSelectNonArrayValueError();
        }

        if (this.renderedOptions.length) {
            this.setOptionsFromValues(this.multiple ? value : [value]);
        }
    }

    /** `View -> model callback called when value changes` */
    onChange: (value: any) => void = () => {};

    registerOnChange(fn: (value: any) => void): void {
        this.onChange = fn;
    }

    /** `View -> model callback called when select has been touched` */
    onTouched = () => {};

    registerOnTouched(fn: () => {}): void {
        this.onTouched = fn;
    }

    /**
     * Sets the disabled state of the control. Implemented as a part of ControlValueAccessor.
     */
    setDisabledState(isDisabled: boolean): void {
        this._disabled = isDisabled;
        this.changeDetectorRef.markForCheck();
    }

    setOptionsFromValues(values: any[]): void {
        this.selectionModel.clear();

        const valuesToSelect = values.reduce((result, value) => {
            return this.treeControl.hasValue(value) ? [...result, this.treeControl.hasValue(value)] : [...result];
        }, []);

        this.selectionModel.select(...valuesToSelect);
    }

    getSelectedValues(): any[] {
        return this.selectionModel.selected.map((selected) => this.treeControl.getValue(selected));
    }

    protected updateTabIndex(): void {
        this._tabIndex = this.renderedOptions.length === 0 ? -1 : 0;
    }

    private updateRenderedOptions = () => {
        const orderedOptions: T[] = [];

        this.sortedNodes.forEach((node) => {
            const found = this.unorderedOptions.find((option) => option.value === this.treeControl.getValue(node));

            if (found) {
                orderedOptions.push(found);
            }
        });

        this.renderedOptions.reset(orderedOptions);
        this.renderedOptions.notifyOnChanges();
    }

    private getSortedNodes(viewContainer: ViewContainerRef) {
        const array: T[] = [];

        for (let i = 0; i < viewContainer.length; i++) {
            const viewRef = viewContainer.get(i) as any;

            array.push(viewRef.context.$implicit);
        }

        return array;
    }

    private allowFocusEscape() {
        if (this._tabIndex !== -1) {
            this._tabIndex = -1;

            setTimeout(() => {
                this._tabIndex = this.userTabIndex || 0;
                this.changeDetectorRef.markForCheck();
            });
        }
    }

    private resetOptions() {
        this.dropSubscriptions();
        this.listenToOptionsFocus();
    }

    private dropSubscriptions() {
        if (this.optionFocusSubscription) {
            this.optionFocusSubscription.unsubscribe();
            this.optionFocusSubscription = null;
        }

        if (this.optionBlurSubscription) {
            this.optionBlurSubscription.unsubscribe();
            this.optionBlurSubscription = null;
        }
    }

    private listenToOptionsFocus(): void {
        this.optionFocusSubscription = this.optionFocusChanges
            .subscribe((event) => {
                const index: number = this.renderedOptions.toArray().indexOf(event.option as T);

                this.renderedOptions
                    .filter((option) => option.hasFocus)
                    .forEach((option) => option.hasFocus = false);

                if (this.isValidIndex(index)) {
                    this.keyManager.updateActiveItem(index);
                }
            });

        this.optionBlurSubscription = this.optionBlurChanges
            .subscribe(() => this.blur());
    }

    /**
     * Utility to ensure all indexes are valid.
     * @param index The index to be checked.
     * @returns True if the index is valid for our list of options.
     */
    private isValidIndex(index: number): boolean {
        return index >= 0 && index < this.renderedOptions.length;
    }

    /** Checks whether any of the options is focused. */
    private hasFocusedOption() {
        return this.renderedOptions.some((option) => option.hasFocus);
    }

    private markOptionsForCheck() {
        if (this.renderedOptions.length) {
            this.renderedOptions.forEach((option) => option.markForCheck());
        }
    }

    private updateOptionsFocus() {
        this.renderedOptions
            .filter((option) => option.hasFocus)
            .forEach((option) => option.hasFocus = false);
    }

    private canDeselectLast(option: McTreeOption): boolean {
        return !(this.noUnselectLast && this.selectionModel.selected.length === 1 && option.selected);
    }

    private isFocusReceivedFromNestedOption($event: FocusEvent) {
        if (!$event || !$event.relatedTarget) { return false; }

        return ($event.relatedTarget as HTMLElement).classList.contains('mc-tree-option');
    }
}

