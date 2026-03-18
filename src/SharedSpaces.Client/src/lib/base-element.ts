import { LitElement } from 'lit';

export class BaseElement extends LitElement {
  protected override createRenderRoot(): this {
    return this;
  }
}
