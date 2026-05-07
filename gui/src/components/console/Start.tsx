import {
  LLMInteractionStartChat,
  LLMInteractionStartComplete,
  LLMInteractionStartFim,
} from "core";
import Expander from "./Expander";
import Message from "./Message";

export interface StartProps {
  item:
    | LLMInteractionStartChat
    | LLMInteractionStartComplete
    | LLMInteractionStartFim;
}

function splitOptionsAndRequest(options: any) {
  const { keypoolLiveRequest, requestBody, ...displayOptions } = options ?? {};
  const request = keypoolLiveRequest
    ? {
        ...keypoolLiveRequest,
        body: requestBody ?? keypoolLiveRequest.input,
      }
    : requestBody
      ? { body: requestBody }
      : undefined;

  return { displayOptions, request };
}

function OptionsAndRequest({ options }: { options: any }) {
  const { displayOptions, request } = splitOptionsAndRequest(options);

  return (
    <>
      <Expander label="Options">
        <pre className="m-0">
          {JSON.stringify(displayOptions, undefined, 2)}
        </pre>
      </Expander>
      {request && (
        <Expander label="Request">
          <pre className="m-0">{JSON.stringify(request, undefined, 2)}</pre>
        </Expander>
      )}
    </>
  );
}

export default function Start({ item }: StartProps) {
  return (
    <div className="border-0 border-b-2 border-solid border-[color:var(--vscode-panel-border)] p-1">
      {(() => {
        switch (item.kind) {
          case "startChat":
            return (
              <>
                <Expander label="Prompt">
                  <div className="p-1">
                    {item.messages.map((message, i) => (
                      <Message key={i} message={message}></Message>
                    ))}
                  </div>
                </Expander>
                <OptionsAndRequest options={item.options} />
              </>
            );
            break;
          case "startComplete":
            return (
              <>
                <Expander label="Prompt">
                  <pre className="m-0">{item.prompt}</pre>
                </Expander>
                <OptionsAndRequest options={item.options} />
              </>
            );
            break;
          case "startFim":
            return (
              <>
                <Expander label="Prefix">
                  <pre className="m-0">{item.prefix}</pre>
                </Expander>
                <Expander label="Suffix">
                  <pre className="m-0">{item.suffix}</pre>
                </Expander>
                <OptionsAndRequest options={item.options} />
              </>
            );
        }
      })()}
    </div>
  );
}
