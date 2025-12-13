// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * Bidirectional Command Channel Contract
 * - Commands: Operator -> Client (via Command event)
 * - Responses: Client -> Operator (via Response event)
 */
contract CommandChannel {
    event Command(bytes encrypted);
    event Response(bytes encrypted);
    
    /**
     * Push a command to the blockchain (operator -> client)
     * @param encrypted The encrypted command bytes
     */
    function pushCommand(bytes calldata encrypted) external {
        emit Command(encrypted);
    }
    
    /**
     * Push a response to the blockchain (client -> operator)
     * @param encrypted The encrypted response bytes
     */
    function pushResponse(bytes calldata encrypted) external {
        emit Response(encrypted);
    }
}

