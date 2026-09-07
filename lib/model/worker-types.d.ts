/** Vite asset imports resolve to bundled URLs rather than Node filesystem paths. */
declare module '*?url' {
  const url: string;
  export default url;
}
/** Vite worker imports expose constructors that start a separate module worker. */
declare module '*?worker' {
  const WorkerFactory: { new (): Worker };
  export default WorkerFactory;
}
