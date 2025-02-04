import * as p from "core/properties"
import {clone} from "core/util/object"
import {HTMLBox, HTMLBoxView} from "models/layouts/html_box"
const _ = (window as any)._;
const Plotly = (window as any).Plotly;

function isPlainObject (obj: any) {
	return Object.prototype.toString.call(obj) === '[object Object]';
}

interface PlotlyHTMLElement extends HTMLElement {
    on(event: 'plotly_relayout', callback: (eventData: any) => void): void;
    on(event: 'plotly_relayouting', callback: (eventData: any) => void): void;
    on(event: 'plotly_restyle', callback: (eventData: any) => void): void;
    on(event: 'plotly_click', callback: (eventData: any) => void): void;
    on(event: 'plotly_hover', callback: (eventData: any) => void): void;
    on(event: 'plotly_clickannotation', callback: (eventData: any) => void): void;
    on(event: 'plotly_selected', callback: (eventData: any) => void): void;
    on(event: 'plotly_deselect', callback: () => void): void;
    on(event: 'plotly_unhover', callback: () => void): void;
}

const filterEventData = (gd: any, eventData: any, event: string) => {
    // Ported from dash-core-components/src/components/Graph.react.js
    let filteredEventData: {[k: string]: any} = Array.isArray(eventData)? []: {};

    if (event === "click" || event === "hover" || event === "selected") {
        const points = [];

        if (eventData === undefined || eventData === null) {
            return null;
        }

        /*
         * remove `data`, `layout`, `xaxis`, etc
         * objects from the event data since they're so big
         * and cause JSON stringify ciricular structure errors.
         *
         * also, pull down the `customdata` point from the data array
         * into the event object
         */
        const data = gd.data;

        for (let i = 0; i < eventData.points.length; i++) {
            const fullPoint = eventData.points[i];

            let pointData: {[k: string]: any} = {};
            for (let property in fullPoint) {
              const val = fullPoint[property];
              if (fullPoint.hasOwnProperty(property) &&
                  !Array.isArray(val) && !isPlainObject(val))  {

                pointData[property] = val;
              }
            }

            if (fullPoint !== undefined && fullPoint !== null) {
              if(fullPoint.hasOwnProperty("curveNumber") &&
                  fullPoint.hasOwnProperty("pointNumber") &&
                  data[fullPoint["curveNumber"]].hasOwnProperty("customdata")) {

                pointData["customdata"] =
                    data[fullPoint["curveNumber"]].customdata[
                        fullPoint["pointNumber"]
                    ]
              }

              // specific to histogram. see https://github.com/plotly/plotly.js/pull/2113/
              if (fullPoint.hasOwnProperty('pointNumbers')) {
                  pointData["pointNumbers"] = fullPoint.pointNumbers;
              }
            }

            points[i] = pointData;
        }
        filteredEventData["points"] = points;
    } else if (event === 'relayout' || event === 'restyle') {
        /*
         * relayout shouldn't include any big objects
         * it will usually just contain the ranges of the axes like
         * "xaxis.range[0]": 0.7715822247381828,
         * "xaxis.range[1]": 3.0095292008680063`
         */
        for (let property in eventData) {
              if (eventData.hasOwnProperty(property))  {
                filteredEventData[property] = eventData[property];
              }
        }
    }
    if (eventData.hasOwnProperty('range')) {
        filteredEventData["range"] = eventData["range"];
    }
    if (eventData.hasOwnProperty('lassoPoints')) {
        filteredEventData["lassoPoints"] = eventData["lassoPoints"];
    }
    return filteredEventData;
};


export class PlotlyPlotView extends HTMLBoxView {
  model: PlotlyPlot
  _setViewport: Function
  _settingViewport: boolean = false
  _plotInitialized: boolean = false
  _reacting: boolean = false

  connect_signals(): void {
    super.connect_signals();

    this.connect(this.model.properties.viewport_update_policy.change,
        this._updateSetViewportFunction);
    this.connect(this.model.properties.viewport_update_throttle.change,
        this._updateSetViewportFunction);

    this.connect(this.model.properties._render_count.change, this.render);
    this.connect(this.model.properties.viewport.change, this._updateViewportFromProperty);
  }

  render(): void {
    if (!(window as any).Plotly) { return }

    const data = [];
    for (let i = 0; i < this.model.data.length; i++) {
      data.push(this._get_trace(i, false));
    }

    this._reacting = true;
    Plotly.react(this.el, data, _.cloneDeep(this.model.layout), this.model.config).then(() => {
        this._updateSetViewportFunction();
        this._updateViewportProperty();

        if (!this._plotInitialized) {
          // Install callbacks

          //  - plotly_relayout
          (<PlotlyHTMLElement>(this.el)).on('plotly_relayout', (eventData: any) => {
            if (eventData['_update_from_property'] !== true) {
              this.model.relayout_data = filterEventData(
                  this.el, eventData, 'relayout');

              this._updateViewportProperty();
            }
          });

          //  - plotly_relayouting
          (<PlotlyHTMLElement>(this.el)).on('plotly_relayouting', () => {
            if (this.model.viewport_update_policy !== 'mouseup') {
              this._updateViewportProperty();
            }
          });

          //  - plotly_restyle
          (<PlotlyHTMLElement>(this.el)).on('plotly_restyle', (eventData: any) => {
            this.model.restyle_data = filterEventData(
                this.el, eventData, 'restyle');

            this._updateViewportProperty();
          });

          //  - plotly_click
          (<PlotlyHTMLElement>(this.el)).on('plotly_click', (eventData: any) => {
            this.model.click_data = filterEventData(
                this.el, eventData, 'click');
          });

          //  - plotly_hover
          (<PlotlyHTMLElement>(this.el)).on('plotly_hover', (eventData: any) => {
            this.model.hover_data = filterEventData(
                this.el, eventData, 'hover');
          });

          //  - plotly_selected
          (<PlotlyHTMLElement>(this.el)).on('plotly_selected', (eventData: any) => {
            this.model.selected_data = filterEventData(
                this.el, eventData, 'selected');
          });

          //  - plotly_clickannotation
          (<PlotlyHTMLElement>(this.el)).on('plotly_clickannotation', (eventData: any) => {
            delete eventData["event"];
            delete eventData["fullAnnotation"];
            this.model.clickannotation_data = eventData
          });

          //  - plotly_deselect
          (<PlotlyHTMLElement>(this.el)).on('plotly_deselect', () => {
            this.model.selected_data = null;
          });

          //  - plotly_unhover
          (<PlotlyHTMLElement>(this.el)).on('plotly_unhover', () => {
            this.model.hover_data = null;
          });
        }
        this._plotInitialized = true;
        this._reacting = false;
      }
    );
  }

  _get_trace(index: number, update: boolean): any {
    const trace = clone(this.model.data[index]);
    const cds = this.model.data_sources[index];
    for (const column of cds.columns()) {
      const shape: number[] = cds._shapes[column][0];
      let array = cds.get_array(column)[0];
      if (shape.length > 1) {
        const arrays = [];
        for (let s = 0; s < shape[0]; s++) {
          arrays.push(array.slice(s*shape[1], (s+1)*shape[1]));
        }
        array = arrays;
      }
      let prop_path = column.split(".");
      let prop = prop_path[prop_path.length - 1];
      var prop_parent = trace;
      for(let k of prop_path.slice(0, -1)) {
        prop_parent = prop_parent[k]
      }

      if (update && prop_path.length == 1) {
        prop_parent[prop] = [array];
      } else {
        prop_parent[prop] = array;
      }
    }
    return trace;
  }

  _updateViewportFromProperty(): void {
    if (!Plotly || this._settingViewport || this._reacting || !this.model.viewport ) { return }

    const fullLayout = (this.el as any)._fullLayout;

    // Call relayout if viewport differs from fullLayout
    _.forOwn(this.model.viewport, (value: any, key: string) => {
      if (!_.isEqual(_.get(fullLayout, key), value)) {
        let clonedViewport = _.cloneDeep(this.model.viewport)
        clonedViewport['_update_from_property'] = true;
        Plotly.relayout(this.el, clonedViewport);
        return false
      } else {
        return true
      }
    });
  }

  _updateViewportProperty(): void {
    const fullLayout = (this.el as any)._fullLayout;
    let viewport: any = {};

    // Get range for all xaxis and yaxis properties
    for (let prop in fullLayout) {
      if (!fullLayout.hasOwnProperty(prop)) {
        continue
      }
      let maybe_axis = prop.slice(0, 5);
      if (maybe_axis === 'xaxis' || maybe_axis === 'yaxis') {
        viewport[prop + '.range'] = _.cloneDeep(fullLayout[prop].range)
      }
    }

    if (!_.isEqual(viewport, this.model.viewport)) {
      this._setViewport(viewport);
    }
  }

  _updateSetViewportFunction(): void {
    if (this.model.viewport_update_policy === "continuous" ||
        this.model.viewport_update_policy === "mouseup") {
      this._setViewport = (viewport: any) => {
        if (!this._settingViewport) {
          this._settingViewport = true;
          this.model.viewport = viewport;
          this._settingViewport = false;
        }
      }
    } else {
      this._setViewport = _.throttle((viewport: any) => {
        if (!this._settingViewport) {
          this._settingViewport = true;
          this.model.viewport = viewport;
          this._settingViewport = false;
        }
      }, this.model.viewport_update_throttle);
    }
  }
}

export namespace PlotlyPlot {
  export type Attrs = p.AttrsOf<Props>
  export type Props = HTMLBox.Props & {
    data: p.Property<any[]>
    layout: p.Property<any>
    config: p.Property<any>
    data_sources: p.Property<any[]>
    relayout_data: p.Property<any>
    restyle_data: p.Property<any>
    click_data: p.Property<any>
    hover_data: p.Property<any>
    clickannotation_data: p.Property<any>
    selected_data: p.Property<any>
    viewport: p.Property<any>
    viewport_update_policy: p.Property<string>
    viewport_update_throttle: p.Property<number>
    _render_count: p.Property<number>
  }
}

export interface PlotlyPlot extends PlotlyPlot.Attrs {}

export class PlotlyPlot extends HTMLBox {
  properties: PlotlyPlot.Props

  constructor(attrs?: Partial<PlotlyPlot.Attrs>) {
    super(attrs)
  }

  static initClass(): void {
    this.prototype.type = "PlotlyPlot"
    this.prototype.default_view = PlotlyPlotView

    this.define<PlotlyPlot.Props>({
      data: [ p.Array, [] ],
      layout: [ p.Any, {} ],
      config: [ p.Any, {} ],
      data_sources: [ p.Array, [] ],
      relayout_data: [ p.Any, {} ],
      restyle_data: [ p.Array, [] ],
      click_data: [ p.Any, {} ],
      hover_data: [ p.Any, {} ],
      clickannotation_data: [ p.Any, {} ],
      selected_data: [ p.Any, {} ],
      viewport: [ p.Any, {} ],
      viewport_update_policy: [ p.String, "mouseup" ],
      viewport_update_throttle: [ p.Number, 200 ],
      _render_count: [ p.Number, 0 ],
    })
  }
}
PlotlyPlot.initClass()
