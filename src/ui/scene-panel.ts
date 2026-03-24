import { Container, Element, Label } from '@playcanvas/pcui';

import { Events } from '../events';
import { localize } from './localization';
import { SplatList } from './splat-list';
import annotationSvg from './svg/annotation.svg';
import sceneImportSvg from './svg/import.svg';
import sceneNewSvg from './svg/new.svg';
import soloSvg from './svg/solo.svg';
import { Tooltips } from './tooltips';
import { Callout } from './callout';
import { Transform } from './transform';

const createSvg = (svgString: string) => {
    const decodedStr = decodeURIComponent(svgString.substring('data:image/svg+xml,'.length));
    return new DOMParser().parseFromString(decodedStr, 'image/svg+xml').documentElement;
};

class ScenePanel extends Container {
    constructor(events: Events, tooltips: Tooltips, args = {}) {
        args = {
            ...args,
            id: 'scene-panel',
            class: 'panel'
        };

        super(args);

        // stop pointer events bubbling
        ['pointerdown', 'pointerup', 'pointermove', 'wheel', 'dblclick'].forEach((eventName) => {
            this.dom.addEventListener(eventName, (event: Event) => event.stopPropagation());
        });

        const sceneHeader = new Container({
            class: 'panel-header'
        });

        const sceneIcon = new Label({
            text: '\uE344',
            class: 'panel-header-icon'
        });

        const sceneLabel = new Label({
            text: localize('panel.scene-manager'),
            class: 'panel-header-label'
        });

        let soloActive = false;

        const soloToggle = new Container({
            class: 'panel-header-button'
        });
        soloToggle.dom.appendChild(createSvg(soloSvg));

        soloToggle.on('click', () => {
            soloActive = !soloActive;
            if (soloActive) {
                soloToggle.class.add('active');
            } else {
                soloToggle.class.remove('active');
            }
            events.fire('scene.solo', soloActive);
        });

        const sceneImport = new Container({
            class: 'panel-header-button'
        });
        sceneImport.dom.appendChild(createSvg(sceneImportSvg));

        const sceneNew = new Container({
            class: 'panel-header-button'
        });
        sceneNew.dom.appendChild(createSvg(sceneNewSvg));

        sceneHeader.append(sceneIcon);
        sceneHeader.append(sceneLabel);
        sceneHeader.append(soloToggle);
        sceneHeader.append(sceneImport);
        sceneHeader.append(sceneNew);

        sceneImport.on('click', async () => {
            await events.invoke('scene.import');
        });

        sceneNew.on('click', () => {
            events.invoke('doc.new');
        });

        tooltips.register(soloToggle, localize('tooltip.scene.solo'), 'top');
        tooltips.register(sceneImport, 'Import Scene', 'top');
        tooltips.register(sceneNew, 'New Scene', 'top');

        const splatList = new SplatList(events);

        const splatListContainer = new Container({
            class: 'splat-list-container'
        });
        splatListContainer.append(splatList);

        const transformHeader = new Container({
            class: 'panel-header'
        });

        const transformIcon = new Label({
            text: '\uE111',
            class: 'panel-header-icon'
        });

        const transformLabel = new Label({
            text: localize('panel.scene-manager.transform'),
            class: 'panel-header-label'
        });

        transformHeader.append(transformIcon);
        transformHeader.append(transformLabel);

        const calloutSection = new Container({
            class: 'panel-section',
            hidden: true
        });

        const calloutHeader = new Container({
            class: 'panel-header'
        });

        const calloutIcon = new Container({
            class: ['panel-header-icon', 'panel-header-icon-svg']
        });
        calloutIcon.dom.appendChild(createSvg(annotationSvg));

        const calloutLabel = new Label({
            text: localize('panel.scene-manager.callout'),
            class: 'panel-header-label'
        });

        const updateCalloutLabel = (draft?: { kind?: 'point' | 'line' | 'box', points?: [number, number, number][] } | null) => {
            let kind = draft?.kind;
            if (!kind && draft?.points?.length) {
                kind = draft.points.length === 1 ? 'point' : (draft.points.length === 2 ? 'line' : 'box');
            }
            calloutLabel.text = kind ?
                `${localize('panel.scene-manager.callout')}: ${kind.toUpperCase()}` :
                localize('panel.scene-manager.callout');
        };

        calloutHeader.append(calloutIcon);
        calloutHeader.append(calloutLabel);

        this.append(sceneHeader);
        this.append(splatListContainer);
        const calloutPanel = new Callout(events);
        calloutSection.append(calloutHeader);
        calloutSection.append(calloutPanel);

        const transformSection = new Container();
        transformSection.append(transformHeader);
        transformSection.append(new Transform(events));

        this.append(transformHeader);
        this.remove(transformHeader);
        this.append(transformSection);
        this.append(calloutSection);
        this.append(new Element({
            class: 'panel-header',
            height: 20
        }));

        events.on('tool.activated', (toolName: string) => {
            calloutSection.hidden = toolName !== 'annotation';
            transformSection.hidden = toolName === 'annotation';
        });

        events.on('tool.deactivated', () => {
            if (events.invoke('tool.active') !== 'annotation') {
                calloutSection.hidden = true;
                transformSection.hidden = false;
            }
        });

        events.on('annotation.draftChanged', (draft) => {
            updateCalloutLabel(draft);
        });

        updateCalloutLabel(events.invoke('annotation.draft') as { kind?: 'point' | 'line' | 'box', points?: [number, number, number][] } | null);
    }
}

export { ScenePanel };
