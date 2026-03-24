import { BooleanInput, Button, ColorPicker, Container, ContainerArgs, Label, NumericInput, SelectInput, TextAreaInput, TextInput } from '@playcanvas/pcui';
import { Vec3 } from 'playcanvas';

import { Events } from '../events';
import { localize } from './localization';

type AnnotationDraft = {
    position: [number, number, number],
    title: string,
    text: string,
    textColor: [number, number, number, number],
    msgBoxColor: [number, number, number, number],
    lineColor: [number, number, number, number],
    lineDecorator: 'none' | 'box' | 'arrowheads',
    lineThickness: number,
    boxColor: [number, number, number, number],
    showMeasurement: boolean,
    measurementUnits: 'm' | 'ft' | 'in' | 'cm',
    camera?: {
        initial: {
            position: [number, number, number],
            target: [number, number, number],
            fov: number
        }
    }
};

class Callout extends Container {
    constructor(events: Events, args: ContainerArgs = {}) {
        args = {
            ...args,
            id: 'callout',
            hidden: true
        };

        super(args);

        const row = (labelText: string, input: any, className: string | string[] = 'callout-row', extras: any[] = []) => {
            const container = new Container({ class: className });
            container.append(new Label({
                class: 'callout-label',
                text: labelText
            }));
            container.append(input);
            extras.forEach(extra => container.append(extra));
            return container;
        };

        const positionSetButton = new Button({
            class: ['select-toolbar-button', 'callout-set-button'],
            text: localize('panel.scene-manager.callout.position-set')
        });

        const captureCameraButton = new Button({
            class: ['select-toolbar-button', 'callout-set-button'],
            text: localize('panel.scene-manager.callout.capture-camera')
        });

        const zoomButton = new Button({
            class: ['select-toolbar-button', 'callout-set-button'],
            text: localize('panel.scene-manager.callout.zoom')
        });

        const titleInput = new TextInput({
            class: 'callout-expand'
        });

        const textInput = new TextAreaInput({
            class: 'callout-text'
        });

        const textColorInput = new ColorPicker({
            class: 'callout-color',
            channels: 4,
            value: [1, 1, 1, 1]
        });

        const msgBoxColorInput = new ColorPicker({
            class: 'callout-color',
            channels: 4,
            value: [0.08, 0.08, 0.08, 0.9]
        });

        const lineColorInput = new ColorPicker({
            class: 'callout-color',
            channels: 4,
            value: [1, 0.4, 0, 1]
        });

        const lineDecoratorInput = new SelectInput({
            class: 'callout-select',
            defaultValue: 'none',
            options: [
                { v: 'none', t: localize('panel.scene-manager.callout.line-decorator.none') },
                { v: 'box', t: localize('panel.scene-manager.callout.line-decorator.box') },
                { v: 'arrowheads', t: localize('panel.scene-manager.callout.line-decorator.arrowheads') }
            ]
        });

        const lineThicknessInput = new NumericInput({
            class: 'callout-expand',
            precision: 2,
            min: 1,
            value: 2
        });

        const boxColorInput = new ColorPicker({
            class: 'callout-color',
            channels: 4,
            value: [1, 0.4, 0, 0.15]
        });

        const showMeasurementInput = new BooleanInput({
            class: 'boolean',
            type: 'toggle',
            value: true
        });

        const measurementUnitsInput = new SelectInput({
            class: 'callout-select',
            defaultValue: 'm',
            options: [
                { v: 'm', t: 'm' },
                { v: 'cm', t: 'cm' },
                { v: 'ft', t: 'ft' },
                { v: 'in', t: 'in' }
            ]
        });

        this.append(row(localize('panel.scene-manager.callout.position-anchor'), new Label({
            class: 'callout-expand',
            text: ''
        }), 'callout-row', [positionSetButton]));
        this.append(row(localize('panel.scene-manager.callout.camera'), zoomButton, 'callout-row', [captureCameraButton]));
        this.append(row(localize('panel.scene-manager.callout.title'), titleInput));
        this.append(row(localize('panel.scene-manager.callout.text'), textInput, ['callout-row', 'callout-row-multiline']));
        this.append(row(localize('panel.scene-manager.callout.text-color'), textColorInput));
        this.append(row(localize('panel.scene-manager.callout.msg-box-color'), msgBoxColorInput));
        this.append(row(localize('panel.scene-manager.callout.line-color'), lineColorInput));
        this.append(row(localize('panel.scene-manager.callout.line-decorator'), lineDecoratorInput));
        this.append(row(localize('panel.scene-manager.callout.line-thickness'), lineThicknessInput));
        this.append(row(localize('panel.scene-manager.callout.box-color'), boxColorInput));
        this.append(row(localize('panel.scene-manager.callout.show-measurement'), showMeasurementInput, 'callout-row', [measurementUnitsInput]));

        let uiUpdating = false;
        const setDraft = (draft: AnnotationDraft) => {
            if (!draft) {
                return;
            }
            uiUpdating = true;
            titleInput.value = draft.title;
            textInput.value = draft.text;
            textColorInput.value = draft.textColor;
            msgBoxColorInput.value = draft.msgBoxColor;
            lineColorInput.value = draft.lineColor;
            lineDecoratorInput.value = draft.lineDecorator;
            lineThicknessInput.value = draft.lineThickness;
            boxColorInput.value = draft.boxColor;
            showMeasurementInput.value = draft.showMeasurement;
            measurementUnitsInput.value = draft.measurementUnits;
            uiUpdating = false;
        };

        const updateDraft = () => {
            if (uiUpdating) {
                return;
            }

            events.fire('annotation.setDraft', {
                title: titleInput.value,
                text: textInput.value,
                textColor: textColorInput.value as [number, number, number, number],
                msgBoxColor: msgBoxColorInput.value as [number, number, number, number],
                lineColor: lineColorInput.value as [number, number, number, number],
                lineDecorator: lineDecoratorInput.value as 'none' | 'box' | 'arrowheads',
                lineThickness: lineThicknessInput.value,
                boxColor: boxColorInput.value as [number, number, number, number],
                showMeasurement: showMeasurementInput.value,
                measurementUnits: measurementUnitsInput.value as 'm' | 'ft' | 'in' | 'cm'
            });
        };

        [
            titleInput,
            textInput,
            textColorInput,
            msgBoxColorInput,
            lineColorInput,
            lineDecoratorInput,
            lineThicknessInput,
            boxColorInput,
            showMeasurementInput,
            measurementUnitsInput
        ].forEach((input: any) => {
            input.on('change', updateDraft);
        });

        positionSetButton.on('click', () => {
            events.fire('annotation.selectLabel');
        });

        captureCameraButton.on('click', () => {
            const pose = events.invoke('camera.getPose') as
                | { position: { x: number, y: number, z: number }, target: { x: number, y: number, z: number }, fov: number }
                | undefined;
            if (!pose) {
                return;
            }

            events.fire('annotation.setDraft', {
                camera: {
                    initial: {
                        position: [pose.position.x, pose.position.y, pose.position.z],
                        target: [pose.target.x, pose.target.y, pose.target.z],
                        fov: pose.fov
                    }
                }
            });
        });

        zoomButton.on('click', () => {
            const draft = events.invoke('annotation.draft') as AnnotationDraft | undefined;
            const initial = draft?.camera?.initial;
            if (!initial) {
                return;
            }

            events.fire('camera.setPose', {
                position: new Vec3(initial.position[0], initial.position[1], initial.position[2]),
                target: new Vec3(initial.target[0], initial.target[1], initial.target[2]),
                fov: initial.fov
            });
        });

        events.on('annotation.draftChanged', (draft: AnnotationDraft) => {
            setDraft(draft);
        });

        events.on('tool.activated', (toolName: string) => {
            this.hidden = toolName !== 'annotation';
        });

        events.on('tool.deactivated', () => {
            if (events.invoke('tool.active') !== 'annotation') {
                this.hidden = true;
            }
        });

    }
}

export { Callout };
