기존의 github은 static한 상태를 push하고 pull하는 방식인데, vibe coding을 하는 상태에서는 협업할 때 file의 conflict뿐만 아니라 context가 서로 달라져서 merge가 불가능한 상태로 많은 양의 작업이 진행되는 경우가 많다.
ctxflow는 실시간으로 서로 다른 작업자의 llm끼리 context를 공유하며, 상대방이 어떤 방식으로 진행하는지를 실시간으로 sync하여 file의 conflict을 최대한 막고, 서로 협업이 진행될 수 있도록 만든다.
즉 vibe coding으로 n명의 작업자가 협업하는 상황에서는 github에 push와 pull하는 것이 깔끔하고 의미있게 기록이 남으면서도 진정한 협업이 가능한 방법이 필요하다.
이를 위한 다양한 기능이 심층적으로 디자인되어야 한다. 불분명한 부분이 있으면 다시 내게 질문해라. 